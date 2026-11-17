package com.patheseck.liseuse;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.json.JSONException;

/**
 * Recherche, dans la mémoire du téléphone (et la carte SD), des fichiers à importer : livres ou
 * table de rappel. Seulement si l'utilisateur l'a autorisé (« Accès à tous les fichiers » depuis
 * Android 11, lecture du stockage avant) ; seuls les noms, tailles et dates sont lus ici, le
 * contenu n'est ouvert que pour les fichiers que l'utilisateur importe.
 */
@CapacitorPlugin(name = "StorageScan", permissions = { @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage") })
public class StorageScanPlugin extends Plugin {

    private static final int MAX_DEPTH = 12;
    private static final long TIME_BUDGET_MS = 30_000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private boolean granted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void resolveStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", granted());
        call.resolve(out);
    }

    @PluginMethod
    public void status(PluginCall call) {
        resolveStatus(call);
    }

    /** Demande l'autorisation : page des réglages d'Android (11 et plus), sinon fenêtre de permission. */
    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) {
            resolveStatus(call);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Page de Liseuse dans les réglages ; sinon (certains téléphones) la liste de toutes les applis.
            try {
                startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName())), "settingsClosed");
            } catch (ActivityNotFoundException e) {
                try {
                    startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "settingsClosed");
                } catch (ActivityNotFoundException e2) {
                    call.reject("Ce téléphone n’a pas de réglage « Accès à tous les fichiers ».", "UNAVAILABLE");
                }
            }
        } else {
            requestPermissionForAlias("storage", call, "permissionAnswered");
        }
    }

    @ActivityCallback
    private void settingsClosed(PluginCall call, ActivityResult result) {
        if (call != null) resolveStatus(call);
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        resolveStatus(call);
    }

    /**
     * Fichiers dont l'extension est demandée (et le nom correspond au motif, s'il y en a un) :
     * chemin, nom, taille, date, dossier. Sans Android/data ni Android/obb (inaccessibles) ni
     * dossiers cachés ; profondeur, nombre et durée bornés.
     */
    @PluginMethod
    public void scan(PluginCall call) {
        Set<String> exts = new HashSet<>();
        try {
            for (Object e : call.getArray("extensions", new JSArray()).toList()) exts.add(String.valueOf(e).toLowerCase(Locale.ROOT));
        } catch (JSONException e) {
            call.reject("Extensions invalides.");
            return;
        }
        Pattern pattern = null;
        String regex = call.getString("namePattern");
        if (regex != null && !regex.isEmpty()) {
            try {
                pattern = Pattern.compile(regex, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
            } catch (PatternSyntaxException e) {
                call.reject("Motif de nom invalide.");
                return;
            }
        }
        int max = call.getInt("maxResults", 1000);
        Pattern finalPattern = pattern;
        worker.execute(() -> {
            if (!granted()) {
                call.reject("Liseuse n’a pas l’autorisation de parcourir les fichiers du téléphone.", "DENIED");
                return;
            }
            Walk walk = new Walk(exts, finalPattern, max);
            List<File> roots = roots();
            for (int i = 0; i < roots.size() && !walk.truncated; i++) walk.dir(roots.get(i), roots.get(i), i == 0 ? "interne" : "sd", 0);
            JSObject out = new JSObject();
            out.put("files", walk.files);
            out.put("truncated", walk.truncated);
            call.resolve(out);
        });
    }

    /** Mémoire interne, puis cartes SD (déduites des dossiers de l'app sur chaque volume). */
    private List<File> roots() {
        List<File> out = new ArrayList<>();
        File primary = Environment.getExternalStorageDirectory();
        if (primary != null && primary.canRead()) out.add(primary);
        File[] appDirs = getContext().getExternalFilesDirs(null);
        if (appDirs == null) return out;
        for (File app : appDirs) {
            if (app == null) continue;
            String path = app.getAbsolutePath();
            int at = path.indexOf("/Android/");
            if (at <= 0) continue;
            File root = new File(path.substring(0, at));
            if (primary != null && root.getAbsolutePath().equals(primary.getAbsolutePath())) continue;
            if (root.canRead()) out.add(root);
        }
        return out;
    }

    private static final class Walk {

        final Set<String> exts;
        final Pattern pattern;
        final int max;
        final long deadline = System.currentTimeMillis() + TIME_BUDGET_MS;
        final JSArray files = new JSArray();
        final Set<String> visited = new HashSet<>();
        int count = 0;
        boolean truncated = false;

        Walk(Set<String> exts, Pattern pattern, int max) {
            this.exts = exts;
            this.pattern = pattern;
            this.max = max;
        }

        void dir(File root, File dir, String volume, int depth) {
            if (truncated || depth > MAX_DEPTH) return;
            if (System.currentTimeMillis() > deadline) {
                truncated = true;
                return;
            }
            try {
                if (!visited.add(dir.getCanonicalPath())) return; // lien qui boucle
            } catch (IOException e) {
                return;
            }
            File[] entries = dir.listFiles();
            if (entries == null) return;
            boolean androidDir = depth == 1 && "Android".equals(dir.getName());
            for (File f : entries) {
                String name = f.getName();
                if (name.startsWith(".")) continue;
                if (f.isDirectory()) {
                    if (androidDir && ("data".equals(name) || "obb".equals(name))) continue;
                    dir(root, f, volume, depth + 1);
                    if (truncated) return;
                } else if (matches(name)) {
                    if (count >= max) {
                        truncated = true;
                        return;
                    }
                    JSObject o = new JSObject();
                    o.put("path", f.getAbsolutePath());
                    o.put("name", name);
                    o.put("size", f.length());
                    o.put("modified", f.lastModified());
                    o.put("folder", relative(root, f.getParentFile()));
                    o.put("volume", volume);
                    files.put(o);
                    count++;
                }
            }
        }

        boolean matches(String name) {
            int dot = name.lastIndexOf('.');
            if (dot <= 0 || !exts.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT))) return false;
            return pattern == null || pattern.matcher(name).find();
        }

        static String relative(File root, File dir) {
            if (dir == null) return "";
            String r = root.getAbsolutePath();
            String d = dir.getAbsolutePath();
            return d.equals(r) ? "" : d.startsWith(r + "/") ? d.substring(r.length() + 1) : d;
        }
    }
}

package com.patheseck.liseuse;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fichier de sauvegarde choisi une fois par l'utilisateur dans le sélecteur d'Android (Google
 * Drive, ou tout autre emplacement) : l'app garde le droit d'y écrire, pour le tenir à jour seule.
 * C'est l'emplacement (l'app Google Drive du téléphone) qui l'envoie en ligne : Liseuse ne se
 * connecte à aucun serveur et ne voit rien d'autre du Drive.
 */
@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {

    private static final int ACCESS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    /** Les écritures passent l'une après l'autre : deux copies ne se mêlent jamais dans le même fichier. */
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    /** Crée le fichier de sauvegarde à l'emplacement choisi. */
    @PluginMethod
    public void create(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("fileName", "Liseuse - sauvegarde.json"));
        intent.addFlags(ACCESS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
    }

    /** Choisit un fichier de sauvegarde existant (pour le restaurer, puis continuer à le tenir à jour). */
    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "application/octet-stream", "text/plain" });
        intent.addFlags(ACCESS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Aucun fichier choisi.", "CANCELLED");
            return;
        }
        Uri uri = data.getData();
        // Droits accordés par l'emplacement (certains refusent l'écriture) : gardés après redémarrage.
        int granted = data.getFlags() & ACCESS;
        try {
            if (granted != 0) getContext().getContentResolver().takePersistableUriPermission(uri, granted);
        } catch (SecurityException ignored) {
            // emplacement sans droits durables : le fichier reste utilisable pendant cette séance
        }
        call.resolve(describe(uri));
    }

    /** Nom, taille, date et droits du fichier ; `exists` faux s'il a été supprimé ou déplacé. */
    @PluginMethod
    public void info(PluginCall call) {
        String value = call.getString("uri");
        if (value == null) {
            call.reject("Fichier non précisé.");
            return;
        }
        call.resolve(describe(Uri.parse(value)));
    }

    /** Remplace le contenu du fichier choisi par celui d'un fichier préparé par l'app (dans son cache). */
    @PluginMethod
    public void write(PluginCall call) {
        String to = call.getString("uri");
        String from = call.getString("from");
        if (to == null || from == null) {
            call.reject("Fichier non précisé.");
            return;
        }
        writer.execute(() -> {
            Uri uri = Uri.parse(to);
            String path = Uri.parse(from).getPath();
            try (InputStream in = new FileInputStream(new File(path == null ? from : path))) {
                long written = copy(in, uri);
                JSObject out = describe(uri);
                out.put("written", written);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject("Liseuse n’a plus le droit d’écrire dans ce fichier.", "ACCESS_LOST", e);
            } catch (FileNotFoundException e) {
                call.reject("Le fichier de sauvegarde est introuvable (supprimé ou déplacé).", "NOT_FOUND", e);
            } catch (Exception e) {
                call.reject("Écriture impossible : " + e.getMessage(), "WRITE_FAILED", e);
            }
        });
    }

    /** Renonce au fichier (fin de la sauvegarde automatique). */
    @PluginMethod
    public void release(PluginCall call) {
        String value = call.getString("uri");
        if (value != null) {
            Uri uri = Uri.parse(value);
            for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (!p.getUri().equals(uri)) continue;
                int flags = (p.isReadPermission() ? Intent.FLAG_GRANT_READ_URI_PERMISSION : 0) | (p.isWritePermission() ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(uri, flags);
                } catch (SecurityException ignored) {
                    // déjà rendu
                }
            }
        }
        call.resolve();
    }

    /** Copie en remplaçant tout l'ancien contenu (« wt » ; sinon « w » et la fin est coupée). */
    private long copy(InputStream in, Uri uri) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ParcelFileDescriptor pfd;
        try {
            pfd = resolver.openFileDescriptor(uri, "wt");
        } catch (SecurityException e) {
            throw e;
        } catch (Exception e) {
            pfd = resolver.openFileDescriptor(uri, "w");
        }
        if (pfd == null) throw new FileNotFoundException(uri.toString());
        long total = 0;
        // Le flux ferme le descripteur, et une erreur de l'emplacement remonte à la fermeture.
        try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pfd)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                total += n;
            }
            out.flush();
            if (out instanceof FileOutputStream) {
                FileOutputStream file = (FileOutputStream) out;
                try {
                    file.getChannel().truncate(total);
                } catch (Exception ignored) {
                    // flux sans fichier derrière (tube vers l'emplacement) : rien à couper
                }
                try {
                    file.getFD().sync();
                } catch (Exception ignored) {
                    // idem
                }
            }
        }
        return total;
    }

    private JSObject describe(Uri uri) {
        JSObject out = new JSObject();
        out.put("uri", uri.toString());
        out.put("provider", uri.getAuthority());
        boolean read = false;
        boolean write = false;
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri)) {
                read = p.isReadPermission();
                write = p.isWritePermission();
            }
        }
        out.put("readable", read);
        out.put("writable", write);
        boolean exists = false;
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                exists = true;
                int name = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int size = c.getColumnIndex(OpenableColumns.SIZE);
                int modified = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (name >= 0 && !c.isNull(name)) out.put("name", c.getString(name));
                if (size >= 0 && !c.isNull(size)) out.put("size", c.getLong(size));
                if (modified >= 0 && !c.isNull(modified)) out.put("lastModified", c.getLong(modified));
            }
        } catch (Exception ignored) {
            // supprimé, déplacé, ou droits perdus
        }
        out.put("exists", exists);
        return out;
    }
}

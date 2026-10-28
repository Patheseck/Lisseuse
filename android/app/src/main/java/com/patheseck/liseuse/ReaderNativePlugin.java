package com.patheseck.liseuse;

import android.graphics.Color;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Fonctions de liseuse propres à Android : touches de volume pour tourner les pages,
 * écran toujours allumé et plein écran immersif pendant la lecture.
 */
@CapacitorPlugin(name = "ReaderNative")
public class ReaderNativePlugin extends Plugin {

    /** Lu par MainActivity pour décider d'intercepter les touches de volume. */
    static volatile boolean volumeKeysEnabled = false;

    /** Lu par MainActivity : masquer le menu de sélection natif (la page affiche le sien). */
    static volatile boolean customSelection = false;

    @PluginMethod
    public void setCustomSelection(PluginCall call) {
        customSelection = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeysEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (enabled) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }
        });
        call.resolve();
    }

    /** Fond de la fenêtre (couleur CSS « #rrggbb ») : visible derrière les barres système. */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        final String color = call.getString("color", "");
        final int parsed;
        try {
            parsed = Color.parseColor(color.trim());
        } catch (IllegalArgumentException e) {
            call.reject("Couleur invalide : " + color);
            return;
        }
        getActivity().runOnUiThread(() -> getActivity().getWindow().getDecorView().setBackgroundColor(parsed));
        call.resolve();
    }

    /** Appelé par MainActivity : transmet la touche à la page web (événement « liseuseVolume »). */
    void onVolumeKey(boolean next) {
        if (bridge != null) bridge.triggerWindowJSEvent("liseuseVolume", "{\"direction\":\"" + (next ? "next" : "prev") + "\"}");
    }
}

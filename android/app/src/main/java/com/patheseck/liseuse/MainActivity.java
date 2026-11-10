package com.patheseck.liseuse;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.ActionMode;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReaderNativePlugin.class);
        registerPlugin(BackupFilePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Sélection de texte dans le lecteur : le menu flottant d'Android est vidé (donc masqué),
     * la barre de la page le remplace. Dans un champ de saisie, la page désactive ce mode.
     */
    @Override
    public void onActionModeStarted(ActionMode mode) {
        super.onActionModeStarted(mode);
        if (ReaderNativePlugin.customSelection && mode.getType() == ActionMode.TYPE_FLOATING) {
            mode.getMenu().clear();
        }
    }

    /** La touche de volume en cours tourne les pages (décidé à son premier appui, gardé jusqu'au relâchement). */
    private boolean volumePaging = false;

    /**
     * Touches de volume : tournent les pages quand le lecteur l'a demandé, sinon comportement normal.
     * Pendant un son (musique d'ambiance, lecture à voix haute), elles règlent le volume, comme partout.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean volume = code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP;
        if (volume && bridge != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                volumePaging = ReaderNativePlugin.volumeKeysEnabled && !isSoundPlaying();
                if (volumePaging) {
                    PluginHandle handle = bridge.getPlugin("ReaderNative");
                    if (handle != null) ((ReaderNativePlugin) handle.getInstance()).onVolumeKey(code == KeyEvent.KEYCODE_VOLUME_DOWN);
                }
            }
            if (volumePaging) return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean isSoundPlaying() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        return audio != null && audio.isMusicActive();
    }
}

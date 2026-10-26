package com.patheseck.liseuse;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReaderNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Touches de volume : tournent les pages quand le lecteur l'a demandé, sinon comportement normal. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean volume = code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP;
        if (volume && ReaderNativePlugin.volumeKeysEnabled && bridge != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                PluginHandle handle = bridge.getPlugin("ReaderNative");
                if (handle != null) ((ReaderNativePlugin) handle.getInstance()).onVolumeKey(code == KeyEvent.KEYCODE_VOLUME_DOWN);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}

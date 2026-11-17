# Project-specific R8/ProGuard rules.
# Capacitor loads plugins and WebView JavaScript dynamically, so keep the
# public Capacitor plugin API and annotations used by reflection.
-keepattributes *Annotation*
-keep class com.getcapacitor.** { *; }
-keep class com.patheseck.liseuse.** { *; }

# Keep WebView/JS bridge methods if one is introduced by a plugin later.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

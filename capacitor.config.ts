import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identifiant conservé depuis la V5 : c'est lui qui relie les mises à jour à l'app installée.
  appId: 'com.patheseck.liseuse',
  appName: 'Liseuse',
  webDir: 'dist',
  android: {
    // Le contenu des livres reste local : aucune navigation vers des sites externes dans l'app.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#A0581A',
    },
  },
};

export default config;

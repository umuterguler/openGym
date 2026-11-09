package ch.duartesantos.opengym;


/** Only the sideload channel installs updates from the official OpenGym release feed. */
final class FlavorPlugins {
    private FlavorPlugins() {}

    static void register(MainActivity activity) {
        if ("sideload".equals(BuildConfig.CHANNEL)) {
            activity.registerFlavorPlugin(InstallPlugin.class);
        }
    }
}

import java.awt.Frame;
import java.util.Arrays;
import local.asobrain.Bootstrap;

/** Owned launcher fixtures exercise reflection without connecting to any game server. */
public final class VerifyBootstrap {
    public static class Current {
        public Frame frame;
        public static String[] captured;

        public void launchWebStart(String[] args) {
            captured = args.clone();
        }

        public void a(String[] args) {
            throw new AssertionError("Used the old alias for a current launcher");
        }
    }

    public static class Legacy extends com.asobrain.games.a.a.m {
        public void launchWebStart(String[] args) {
            throw new AssertionError("Did not select the verified legacy API");
        }
    }

    public static class Unsupported {}

    public static void main(String[] args) {
        // The native display controller is supplied by CheerpJ, outside this host-only fixture.
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            public void uncaughtException(Thread thread, Throwable error) {
                if (error instanceof UnsatisfiedLinkError && error.getMessage().contains("viewStateNative")) return;
                error.printStackTrace();
                System.exit(1);
            }
        });
        String[] parameters = {"user=Owned fixture", "auth=test&token", "primaryPort=1972"};
        String[] launch = new String[parameters.length + 1];
        System.arraycopy(parameters, 0, launch, 1, parameters.length);
        launch[0] = "--client-class=" + Current.class.getName();
        Bootstrap.main(launch);
        if (!Arrays.equals(parameters, Current.captured)) throw new AssertionError("Current launcher arguments changed");
        launch[0] = "--client-class=" + Legacy.class.getName();
        Bootstrap.main(launch);
        if (!Arrays.equals(parameters, com.asobrain.games.a.a.m.captured)) throw new AssertionError("Legacy launcher arguments changed");
        System.out.println("Verified current/legacy launcher member selection and raw argument forwarding.");
    }
}

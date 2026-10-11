package local.asobrain;

import java.awt.EventQueue;
import java.awt.Frame;
import java.util.Arrays;

public final class Bootstrap {
    public static void main(String[] args) {
        final Frame frame;
        try {
            if (args.length == 0 || !args[0].startsWith("--client-class=")) {
                throw new IllegalArgumentException("The original client launcher class is required");
            }
            Class<?> clientClass = Class.forName(args[0].substring("--client-class=".length()));
            Object client = clientClass.getConstructor().newInstance();
            // Verified API names in the pinned older Practice 2vs2 client.
            boolean legacy = "com.asobrain.games.a.a.m".equals(clientClass.getSuperclass().getName());
            clientClass.getMethod(legacy ? "a" : "launchWebStart", String[].class)
                .invoke(client, (Object) Arrays.copyOfRange(args, 1, args.length));
            frame = (Frame) clientClass.getField(legacy ? "i" : "frame").get(client);
        } catch (Exception error) {
            error.printStackTrace();
            System.exit(1);
            return;
        }
        Thread display = new Thread(new Runnable() {
            @Override
            public void run() {
                while (true) {
                    String[] state = viewStateNative().split(",");
                    SmoothAssets.setSmooth("1".equals(state[0]));
                    final int width = Integer.parseInt(state[1]);
                    final int height = Integer.parseInt(state[2]);
                    EventQueue.invokeLater(new Runnable() {
                        @Override
                        public void run() {
                            if (frame != null && (frame.getX() != 0 || frame.getY() != 0
                                    || frame.getWidth() != width || frame.getHeight() != height)) {
                                frame.setBounds(0, 0, width, height);
                                frame.validate();
                                frame.repaint();
                            }
                        }
                    });
                }
            }
        }, "Display controller");
        display.setDaemon(true);
        display.start();
    }

    private static native String viewStateNative();
}

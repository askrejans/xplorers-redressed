// SPDX-License-Identifier: GPL-3.0-only
package fixture;

import java.awt.Color;
import java.awt.Container;
import java.awt.EventQueue;
import java.awt.Frame;
import java.awt.Graphics;
import java.awt.Image;
import java.awt.Rectangle;
import local.asobrain.SmoothAssets;

/** Owned panels reproduce the legacy rectangular-clip cast without game code or assets. */
public final class OwnedPaintFixture {
    private static volatile boolean ready;

    private static final class Panel extends Container {
        private final Color color;
        private final String title;

        Panel(Color color, String title) {
            this.color = color;
            this.title = title;
        }

        public void paint(Graphics graphics) {
            if (!ready) return;
            Rectangle clip = (Rectangle) graphics.getClip();
            System.out.println("AWT panel " + title + " clip=" + clip);
            graphics.setColor(color);
            graphics.fillRect(clip.x, clip.y, clip.width, clip.height);
            graphics.setColor(Color.BLACK);
            graphics.drawString(title, 10, 30);
        }
    }

    private static final class Board extends Container {
        private Image buffer;
        private int completePaints;

        Board() { setLayout(null); }

        public void paint(Graphics graphics) {
            int width = getWidth(), height = getHeight();
            if (buffer == null) buffer = SmoothAssets.createImage(this, width, height);
            Graphics offscreen = buffer.getGraphics();
            try {
                offscreen.setClip(0, 0, width, height);
                offscreen.setColor(Color.BLUE);
                offscreen.fillRect(0, 0, width, height);
                super.paint(offscreen);
                SmoothAssets.drawImage(graphics, buffer, 0, 0, width, height, this);
                completePaints++;
            } finally {
                offscreen.dispose();
            }
        }

        public void update(Graphics graphics) { paint(graphics); }
    }

    public static void main(String[] args) throws Exception {
        SmoothAssets.setSmooth(args.length > 0 && "enhanced".equals(args[0]));
        EventQueue.invokeAndWait(new Runnable() { public void run() {} });
        Frame frame = new Frame("Owned AWT paint regression");
        final Board board = new Board();
        Panel map = new Panel(Color.GREEN, "Map");
        Panel players = new Panel(Color.ORANGE, "Players");
        Panel resources = new Panel(Color.CYAN, "Resources");
        board.add(map); map.setBounds(20, 30, 160, 180);
        board.add(players); players.setBounds(200, 30, 160, 110);
        board.add(resources); resources.setBounds(200, 150, 160, 60);
        frame.add(board);
        frame.setSize(480, 320);
        frame.setVisible(true);
        Thread.sleep(3000);
        EventQueue.invokeAndWait(new Runnable() {
            public void run() { ready = true; board.repaint(); }
        });
        Thread.sleep(3000);
        System.out.println("AWT fixture finished; complete paints=" + board.completePaints);
        // Keep the client alive while the browser verifies the displayed panels.
        Thread.sleep(60000);
    }
}

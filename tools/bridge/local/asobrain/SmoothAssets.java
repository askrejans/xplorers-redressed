package local.asobrain;

import java.awt.Canvas;
import java.awt.Component;
import java.awt.Container;
import java.awt.EventQueue;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.MediaTracker;
import java.awt.RenderingHints;
import java.awt.Toolkit;
import java.awt.Window;
import java.awt.image.BufferedImage;
import java.awt.image.ImageObserver;
import java.awt.image.ImageProducer;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;

/** Smooth original pixels while retaining logical image and game coordinates. */
public final class SmoothAssets {
    private static final int ASSET_SCALE = 4;
    private static final int BUFFER_SCALE = 2;
    private static final Map<Image, Image> images = Collections.synchronizedMap(new WeakHashMap<Image, Image>());
    private static final Set<Image> animated = Collections.synchronizedSet(
        Collections.newSetFromMap(new WeakHashMap<Image, Boolean>()));
    private static volatile boolean smooth = false;

    public static Image createImage(Toolkit toolkit, byte[] data) {
        Image original = toolkit.createImage(data);
        if (animatedGif(data)) animated.add(original);
        // PixelGrabber-based ocean rotations require decoded pixels before their first paint.
        MediaTracker tracker = new MediaTracker(new Canvas());
        tracker.addImage(original, 0);
        try {
            tracker.waitForID(0, 5000);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
        return original;
    }

    public static Image createImage(Component component, int width, int height) {
        return width > 0 && height > 0 ? new HiDpiImage(width, height) : component.createImage(width, height);
    }

    private static boolean animatedGif(byte[] data) {
        if (data.length < 13 || data[0] != 'G' || data[1] != 'I' || data[2] != 'F') return false;
        int packed = data[10] & 255;
        int offset = 13 + ((packed & 128) != 0 ? 3 * (1 << ((packed & 7) + 1)) : 0);
        int frames = 0;
        while (offset < data.length) {
            int block = data[offset++] & 255;
            if (block == 0x3b) return false;
            if (block == 0x2c) {
                if (++frames > 1) return true;
                if (offset + 9 > data.length) return false;
                packed = data[offset + 8] & 255;
                offset += 9 + ((packed & 128) != 0 ? 3 * (1 << ((packed & 7) + 1)) : 0);
                offset++; // LZW minimum code size.
            } else if (block == 0x21) {
                offset++; // Extension label.
            } else {
                return false;
            }
            while (offset < data.length) {
                int length = data[offset++] & 255;
                if (length == 0) break;
                offset += length;
            }
        }
        return false;
    }

    private static Image select(Image original, ImageObserver observer) {
        if (original instanceof HiDpiImage) return ((HiDpiImage) original).backing;
        if (!smooth || original == null || animated.contains(original)) return original;
        Image enhanced = images.get(original);
        if (enhanced != null) return enhanced;
        int width = original.getWidth(observer), height = original.getHeight(observer);
        if (width < 1 || height < 1 || width > 200 || height > 200) return original;
        BufferedImage generated = new BufferedImage(width * ASSET_SCALE, height * ASSET_SCALE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = generated.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        boolean complete = graphics.drawImage(original, 0, 0, width * ASSET_SCALE, height * ASSET_SCALE, observer);
        graphics.dispose();
        if (!complete) return original;
        images.put(original, generated);
        return generated;
    }

    private static Graphics graphics(Graphics source) {
        Graphics copy = source.create();
        if (smooth && copy instanceof Graphics2D) ((Graphics2D) copy).setRenderingHint(
            RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        return copy;
    }

    public static boolean drawImage(Graphics source, Image original, int x, int y, ImageObserver observer) {
        if (original == null) return false;
        int width = original.getWidth(observer), height = original.getHeight(observer);
        if (width > 0 && height > 0) return drawImage(source, original, x, y, width, height, observer);
        Graphics graphics = graphics(source);
        try {
            return graphics.drawImage(original, x, y, observer);
        } finally {
            graphics.dispose();
        }
    }

    public static boolean drawImage(Graphics source, Image original, int x, int y, int width, int height, ImageObserver observer) {
        Graphics graphics = graphics(source);
        try {
            return graphics.drawImage(select(original, observer), x, y, width, height, observer);
        } finally {
            graphics.dispose();
        }
    }

    public static boolean drawImage(Graphics source, Image original, int dx1, int dy1, int dx2, int dy2,
            int sx1, int sy1, int sx2, int sy2, ImageObserver observer) {
        Image selected = select(original, observer);
        int scale = original instanceof HiDpiImage ? BUFFER_SCALE : selected != original ? ASSET_SCALE : 1;
        Graphics graphics = graphics(source);
        try {
            return graphics.drawImage(selected, dx1, dy1, dx2, dy2,
                sx1 * scale, sy1 * scale, sx2 * scale, sy2 * scale, observer);
        } finally {
            graphics.dispose();
        }
    }

    public static void setSmooth(boolean enabled) {
        if (smooth == enabled) return;
        smooth = enabled;
        EventQueue.invokeLater(new Runnable() {
            public void run() {
                // These optional caches belong to Xplorers; other supported game archives omit them.
                clearCache("asobrain.xplorers.common.card.Card", "_imageCache", "a");
                clearCache("asobrain.xplorers.common.island.Ocean", "OCEAN_IMAGES", "n");
                for (Window window : Window.getWindows()) refresh(window);
            }
        });
    }

    private static void clearCache(String className, String... fieldNames) {
        try {
            Class<?> type = Class.forName(className, false, SmoothAssets.class.getClassLoader());
            Field field = null;
            // The older Practice 2 vs 2 archive obfuscates these exact artwork cache fields.
            for (String name : fieldNames) {
                try {
                    field = type.getDeclaredField(name);
                    break;
                } catch (NoSuchFieldException otherVersion) {
                    // Try the verified field name from the other supported client version.
                }
            }
            if (field == null) throw new NoSuchFieldException(className);
            field.setAccessible(true);
            Object value = field.get(null);
            if (value instanceof Map) ((Map<?, ?>) value).clear();
            else field.set(null, null);
        } catch (ClassNotFoundException absentGameClass) {
            // This archive does not use the Xplorers artwork caches.
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Cannot refresh game artwork cache", error);
        }
    }

    private static void refresh(Component component) {
        String className = component.getClass().getName();
        String clearMethod = className.endsWith(".IslandView") ? "clearIslandImage"
            : className.equals("asobrain.xplorers.a.b.k") ? "b" : null;
        if (clearMethod != null) {
            try {
                Method method = component.getClass().getMethod(clearMethod);
                method.invoke(component);
            } catch (ReflectiveOperationException error) {
                throw new IllegalStateException("Cannot refresh the game island", error);
            }
        }
        if (component instanceof Container) {
            for (Component child : ((Container) component).getComponents()) refresh(child);
        }
        component.repaint();
    }

    /** Buffered drawing remains at screen resolution until the final canvas paint. */
    public static final class HiDpiImage extends Image {
        private final int width;
        private final int height;
        private final BufferedImage backing;

        HiDpiImage(int width, int height) {
            this.width = width;
            this.height = height;
            backing = new BufferedImage(width * BUFFER_SCALE, height * BUFFER_SCALE, BufferedImage.TYPE_INT_ARGB);
        }

        public int getWidth(ImageObserver observer) { return width; }
        public int getHeight(ImageObserver observer) { return height; }
        public Object getProperty(String name, ImageObserver observer) { return backing.getProperty(name, observer); }

        public Graphics getGraphics() {
            Graphics2D graphics = backing.createGraphics();
            graphics.scale(BUFFER_SCALE, BUFFER_SCALE);
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, smooth
                ? RenderingHints.VALUE_INTERPOLATION_BICUBIC : RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            return graphics;
        }

        public ImageProducer getSource() {
            // PixelGrabber callers expect the logical dimensions, including colour-tinted pieces.
            BufferedImage logical = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = logical.createGraphics();
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.drawImage(backing, 0, 0, width, height, null);
            graphics.dispose();
            return logical.getSource();
        }
    }
}

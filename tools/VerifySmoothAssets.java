import java.awt.BasicStroke;
import java.awt.Canvas;
import java.awt.Color;
import java.awt.EventQueue;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.RenderingHints;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.awt.image.PixelGrabber;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.HashMap;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import local.asobrain.SmoothAssets;

/** Synthetic fixtures prove real resolution, geometry, crops, animation handling and mode changes. */
public final class VerifySmoothAssets {
    private static final class ObfuscatedCacheFixture {
        private static final Map<String, Image> a = new HashMap<String, Image>();
        private static Image[] n = new Image[1];
    }
    private static int[] pixels(BufferedImage image) {
        return image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
    }

    private static BufferedImage surface(int width, int height) {
        return new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
    }

    private static BufferedImage enlarged(Image original, int width, int height, int scale) {
        BufferedImage result = surface(width * scale, height * scale);
        Graphics2D graphics = result.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        graphics.drawImage(original, 0, 0, result.getWidth(), result.getHeight(), null);
        graphics.dispose();
        return result;
    }

    private static void same(BufferedImage actual, BufferedImage expected, String message) {
        if (!Arrays.equals(pixels(actual), pixels(expected))) throw new AssertionError(message);
    }

    private static void mode(boolean enabled) throws Exception {
        SmoothAssets.setSmooth(enabled);
        EventQueue.invokeAndWait(new Runnable() { public void run() {} });
    }

    private static void vector(Graphics2D graphics) {
        graphics.setColor(Color.BLUE);
        graphics.fillRect(2, 3, 11, 9);
        graphics.setColor(Color.RED);
        graphics.setStroke(new BasicStroke(0.5f));
        graphics.drawLine(3, 4, 24, 27);
    }

    private static byte[] gif(int frames) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageWriter writer = ImageIO.getImageWritersByFormatName("gif").next();
        try (ImageOutputStream output = ImageIO.createImageOutputStream(bytes)) {
            writer.setOutput(output);
            writer.prepareWriteSequence(null);
            for (int frame = 0; frame < frames; frame++) {
                BufferedImage image = surface(12, 12);
                Graphics2D graphics = image.createGraphics();
                graphics.setColor(frame == 0 ? Color.RED : Color.BLUE);
                graphics.fillRect(0, 0, 12, 12);
                graphics.dispose();
                writer.writeToSequence(new IIOImage(image, null, null), writer.getDefaultWriteParam());
            }
            writer.endWriteSequence();
        } finally {
            writer.dispose();
        }
        return bytes.toByteArray();
    }

    public static void main(String[] args) throws Exception {
        BufferedImage fixture = surface(16, 16);
        Graphics2D graphics = fixture.createGraphics();
        graphics.setColor(Color.BLACK);
        graphics.fillOval(1, 1, 14, 14);
        graphics.setColor(Color.YELLOW);
        graphics.fillRect(5, 4, 7, 9);
        graphics.dispose();
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(fixture, "png", png);
        Image original = SmoothAssets.createImage(Toolkit.getDefaultToolkit(), png.toByteArray());
        if (original.getWidth(null) != 16 || original.getHeight(null) != 16) {
            throw new AssertionError("Original image geometry changed or first pixels were not ready");
        }
        int[] decoded = new int[256];
        new PixelGrabber(original, 0, 0, 16, 16, decoded, 0, 16).grabPixels();
        if (!Arrays.equals(decoded, pixels(fixture))) throw new AssertionError("Original pixels changed");

        BufferedImage originalMode = surface(64, 64);
        graphics = originalMode.createGraphics();
        SmoothAssets.drawImage(graphics, original, 0, 0, 64, 64, null);
        graphics.dispose();
        BufferedImage expected = surface(64, 64);
        graphics = expected.createGraphics();
        graphics.drawImage(original, 0, 0, 64, 64, null);
        graphics.dispose();
        same(originalMode, expected, "Original is not the default or original artwork rendering changed");

        mode(true);
        BufferedImage enhanced = surface(64, 64);
        graphics = enhanced.createGraphics();
        SmoothAssets.drawImage(graphics, original, 0, 0, 64, 64, null);
        graphics.dispose();
        BufferedImage artwork = enlarged(original, 16, 16, 4);
        same(enhanced, artwork, "Enhanced did not use actual 4x resampled pixels");
        if (Arrays.equals(pixels(enhanced), pixels(originalMode))) throw new AssertionError("Enhanced has no visible pixel difference");

        Image buffer = SmoothAssets.createImage(new Canvas(), 32, 32);
        if (buffer.getWidth(null) != 32 || buffer.getHeight(null) != 32) throw new AssertionError("Buffer logical geometry changed");
        graphics = (Graphics2D) buffer.getGraphics();
        vector(graphics);
        graphics.dispose();
        BufferedImage output = surface(64, 64);
        graphics = output.createGraphics();
        graphics.scale(2, 2);
        SmoothAssets.drawImage(graphics, buffer, 0, 0, null);
        graphics.dispose();
        BufferedImage highDpi = surface(64, 64);
        graphics = highDpi.createGraphics();
        graphics.scale(2, 2);
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        vector(graphics);
        graphics.dispose();
        same(output, highDpi, "Offscreen rendering lost high DPI backing before the final draw");

        PixelGrabber logicalPixels = new PixelGrabber(buffer, 0, 0, -1, -1, true);
        logicalPixels.grabPixels();
        if (logicalPixels.getWidth() != 32 || logicalPixels.getHeight() != 32) {
            throw new AssertionError("PixelGrabber saw physical backing dimensions instead of game dimensions");
        }
        BufferedImage logicalExpected = surface(32, 32);
        graphics = logicalExpected.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        graphics.drawImage(highDpi, 0, 0, 32, 32, null);
        graphics.dispose();
        if (!Arrays.equals((int[]) logicalPixels.getPixels(), pixels(logicalExpected))) {
            throw new AssertionError("PixelGrabber cropped the high DPI backing instead of reading the entire logical image");
        }

        ObfuscatedCacheFixture.a.put("card", original);
        ObfuscatedCacheFixture.n[0] = original;
        Method clear = SmoothAssets.class.getDeclaredMethod("clearCache", String.class, String[].class);
        clear.setAccessible(true);
        clear.invoke(null, ObfuscatedCacheFixture.class.getName(), new String[] { "_imageCache", "a" });
        clear.invoke(null, ObfuscatedCacheFixture.class.getName(), new String[] { "OCEAN_IMAGES", "n" });
        if (!ObfuscatedCacheFixture.a.isEmpty() || ObfuscatedCacheFixture.n != null) {
            throw new AssertionError("Obfuscated artwork cache aliases were not invalidated");
        }

        BufferedImage cropped = surface(40, 40);
        graphics = cropped.createGraphics();
        SmoothAssets.drawImage(graphics, buffer, 0, 0, 40, 40, 2, 3, 22, 23, null);
        graphics.dispose();
        expected = surface(40, 40);
        graphics = expected.createGraphics();
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        graphics.drawImage(highDpi, 0, 0, 40, 40, 4, 6, 44, 46, null);
        graphics.dispose();
        same(cropped, expected, "High DPI offscreen crop used incorrect source coordinates");

        Image animation = SmoothAssets.createImage(Toolkit.getDefaultToolkit(), gif(2));
        Field field = SmoothAssets.class.getDeclaredField("animated");
        field.setAccessible(true);
        if (!((Set<?>) field.get(null)).contains(animation)) throw new AssertionError("Animated GIF not detected");
        graphics = surface(48, 48).createGraphics();
        SmoothAssets.drawImage(graphics, animation, 0, 0, 48, 48, null);
        graphics.dispose();
        field = SmoothAssets.class.getDeclaredField("images");
        field.setAccessible(true);
        if (((Map<?, ?>) field.get(null)).containsKey(animation)) throw new AssertionError("Animation was frozen into a cached first frame");

        mode(false);
        output = surface(64, 64);
        graphics = output.createGraphics();
        SmoothAssets.drawImage(graphics, original, 0, 0, 64, 64, null);
        graphics.dispose();
        same(output, originalMode, "Live Original mode did not restore original source rendering");
        System.out.println("Verified original pixels/default, 4x enhancement, 2x offscreen preservation, logical PixelGrabber, crops, obfuscated caches, animation handling, and live mode changes.");
    }
}

package local.asobrain;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketAddress;
import java.net.SocketException;

/** Only the game's socket construction uses this Electron transport. */
public final class BridgeSocket extends Socket {
    private int id = -1;
    private int timeout;
    private boolean closed;
    private InetAddress remoteAddress;
    private InetAddress localAddress;
    private int remotePort;
    private int localPort;
    private InputStream input;
    private OutputStream output;

    public BridgeSocket() {
        super();
    }

    public BridgeSocket(String host, int port) throws IOException {
        this();
        open(host, port);
    }

    @Override
    public void connect(SocketAddress endpoint, int connectTimeout) throws IOException {
        if (!(endpoint instanceof InetSocketAddress)) {
            throw new IllegalArgumentException("Expected an internet socket address");
        }
        if (connectTimeout < 0) {
            throw new IllegalArgumentException("Negative connect timeout");
        }
        InetSocketAddress address = (InetSocketAddress) endpoint;
        open(address.getHostString(), address.getPort());
    }

    @Override
    public void connect(SocketAddress endpoint) throws IOException {
        connect(endpoint, 0);
    }

    private void open(String host, int port) throws IOException {
        if (closed || id >= 0) {
            throw new SocketException(closed ? "Socket closed" : "Already connected");
        }
        id = openNative(host, port);
        try {
            String[] addresses = addressesNative(id).split("\\n");
            remoteAddress = InetAddress.getByName(addresses[0]);
            localAddress = InetAddress.getByName(addresses[1]);
            remotePort = Integer.parseInt(addresses[2]);
            localPort = Integer.parseInt(addresses[3]);
        } catch (IOException | RuntimeException error) {
            close();
            throw error;
        }
        input = new BufferedInputStream(new InputStream() {
            @Override
            public int read() throws IOException {
                byte[] value = new byte[1];
                return read(value, 0, 1) < 0 ? -1 : value[0] & 255;
            }

            @Override
            public int read(byte[] bytes, int offset, int length) throws IOException {
                if (bytes == null) throw new NullPointerException();
                if (offset < 0 || length < 0 || offset > bytes.length - length) {
                    throw new IndexOutOfBoundsException();
                }
                if (length == 0) return 0;
                requireConnected();
                return readNative(id, bytes, offset, length, timeout);
            }

            @Override
            public int available() throws IOException {
                requireConnected();
                return availableNative(id);
            }

            @Override
            public void close() throws IOException {
                BridgeSocket.this.close();
            }
        });
        output = new OutputStream() {
            @Override
            public void write(int value) throws IOException {
                write(new byte[]{(byte) value}, 0, 1);
            }

            @Override
            public void write(byte[] bytes, int offset, int length) throws IOException {
                if (bytes == null) throw new NullPointerException();
                if (offset < 0 || length < 0 || offset > bytes.length - length) {
                    throw new IndexOutOfBoundsException();
                }
                requireConnected();
                if (length > 0) writeNative(id, bytes, offset, length);
            }

            @Override
            public void close() throws IOException {
                BridgeSocket.this.close();
            }
        };
    }

    private void requireConnected() throws SocketException {
        if (closed || id < 0) throw new SocketException(closed ? "Socket closed" : "Not connected");
    }

    @Override
    public InputStream getInputStream() throws IOException {
        requireConnected();
        return input;
    }

    @Override
    public OutputStream getOutputStream() throws IOException {
        requireConnected();
        return output;
    }

    @Override
    public synchronized void setSoTimeout(int value) throws SocketException {
        if (value < 0) throw new IllegalArgumentException("Negative read timeout");
        if (closed) throw new SocketException("Socket closed");
        timeout = value;
    }

    @Override
    public synchronized int getSoTimeout() { return timeout; }

    @Override
    public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        if (id >= 0) closeNative(id);
    }

    @Override
    public boolean isConnected() { return id >= 0; }

    @Override
    public boolean isClosed() { return closed; }

    @Override
    public InetAddress getInetAddress() { return remoteAddress; }

    @Override
    public InetAddress getLocalAddress() { return localAddress; }

    @Override
    public int getPort() { return remotePort; }

    @Override
    public int getLocalPort() { return localPort; }

    private static native int openNative(String host, int port) throws IOException;
    private static native String addressesNative(int id) throws IOException;
    private static native int readNative(int id, byte[] bytes, int offset, int length, int timeout) throws IOException;
    private static native void writeNative(int id, byte[] bytes, int offset, int length) throws IOException;
    private static native int availableNative(int id) throws IOException;
    private static native void closeNative(int id) throws IOException;
}

package it.iw1fzr.dxcluster.plugins;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@CapacitorPlugin(name = "TelnetCluster")
public class TelnetClusterPlugin extends Plugin {

    private static final String TAG = "TelnetCluster";
    private Socket socket;
    private PrintWriter writer;
    private BufferedReader reader;
    private ExecutorService executor = Executors.newCachedThreadPool();
    private Future<?> readTask;
    private boolean connected = false;

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host", "dx.iw1fzr.it");
        int    port = call.getInt("port", 7300);
        executor.execute(() -> {
            try {
                closeSocket();
                socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 10000);
                socket.setSoTimeout(120000);
                socket.setKeepAlive(true);
                socket.setTcpNoDelay(true);
                writer = new PrintWriter(socket.getOutputStream(), true);
                reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), "UTF-8"));
                connected = true;
                JSObject ev = new JSObject();
                ev.put("host", host); ev.put("port", port);
                notifyListeners("connected", ev);
                call.resolve(ev);
                startReading();
            } catch (IOException e) {
                connected = false;
                JSObject err = new JSObject(); err.put("message", e.getMessage());
                notifyListeners("connectionError", err);
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> { closeSocket(); call.resolve(); });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data", "");
        if (!connected || writer == null) { call.reject("Non connesso"); return; }
        executor.execute(() -> {
            writer.print(data + "\r\n");
            writer.flush();
            call.resolve();
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject res = new JSObject();
        res.put("connected", connected);
        call.resolve(res);
    }

    private void startReading() {
        if (readTask != null) readTask.cancel(true);
        readTask = executor.submit(() -> {
            try {
                String line;
                while (connected && (line = reader.readLine()) != null) {
                    final String l = line.trim();
                    if (l.isEmpty()) continue;
                    JSObject ev = new JSObject(); ev.put("line", l);
                    if (l.toUpperCase().startsWith("DX DE"))
                        notifyListeners("spotReceived", ev);
                    else
                        notifyListeners("rawLine", ev);
                }
            } catch (IOException e) {
                if (connected) {
                    connected = false;
                    JSObject ev = new JSObject(); ev.put("message", e.getMessage());
                    notifyListeners("disconnected", ev);
                }
            }
        });
    }

    private void closeSocket() {
        connected = false;
        try { if (readTask != null) readTask.cancel(true); } catch (Exception ignored) {}
        try { if (writer  != null) writer.close();  } catch (Exception ignored) {}
        try { if (reader  != null) reader.close();  } catch (Exception ignored) {}
        try { if (socket  != null) socket.close();  } catch (Exception ignored) {}
        writer = null; reader = null; socket = null;
        notifyListeners("disconnected", new JSObject());
    }

    @Override protected void handleOnDestroy() { closeSocket(); executor.shutdownNow(); }
}

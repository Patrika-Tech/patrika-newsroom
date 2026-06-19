package com.patrika.fieldportal;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private WebView      webView;
    private View         loadingLayout;
    private TextView     loadingUrl;
    private LocationManager locationManager;
    private Location     lastGpsLocation;     // GPS_PROVIDER — accurate
    private Location     lastNetLocation;     // NETWORK_PROVIDER — fallback only
    private ValueCallback<Uri[]> filePathCallback;
    private Uri          cameraImageUri;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private static final int    PERM_CODE        = 101;
    private static final int    FILE_CHOOSER_CODE = 102;
    private static final String PREFS            = "FieldPortalPrefs";
    private static final String KEY_SERVER       = "server_url";
    private static final String DEFAULT_URL      = "http://10.30.9.201:3000/reporter";

    // ── Android GPS bridge ────────────────────────────────────────────────────
    class AndroidGPS {
        @JavascriptInterface
        public String getLocation() {
            long now = System.currentTimeMillis();
            // Prefer GPS satellite fix (accurate). Only use it if < 60 seconds old.
            if (lastGpsLocation != null && (now - lastGpsLocation.getTime()) < 60000)
                return lastGpsLocation.getLatitude() + "," + lastGpsLocation.getLongitude()
                     + "," + Math.round(lastGpsLocation.getAccuracy());
            // Fall back to network location if < 30 seconds old
            if (lastNetLocation != null && (now - lastNetLocation.getTime()) < 30000)
                return lastNetLocation.getLatitude() + "," + lastNetLocation.getLongitude()
                     + "," + Math.round(lastNetLocation.getAccuracy());
            // No fresh location — JS will fall back to native WebView geolocation
            return "null";
        }
        @JavascriptInterface
        public boolean hasPermission() {
            return ContextCompat.checkSelfPermission(MainActivity.this,
                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
    }

    // Separate listeners per provider so we can distinguish GPS vs network
    private final LocationListener gpsListener = new LocationListener() {
        @Override public void onLocationChanged(Location loc) { lastGpsLocation = loc; }
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle e) {}
    };

    private final LocationListener netListener = new LocationListener() {
        @Override public void onLocationChanged(Location loc) { lastNetLocation = loc; }
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle e) {}
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        loadingLayout = findViewById(R.id.loadingLayout);
        loadingUrl    = findViewById(R.id.loadingUrl);
        webView       = findViewById(R.id.webview);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setGeolocationDatabasePath(getFilesDir().getPath());
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE); // prevent stale service worker cache

        webView.addJavascriptInterface(new AndroidGPS(), "AndroidGPS");
        webView.clearCache(true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                cb.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;

                Intent cameraIntent = null;
                cameraImageUri = null;
                try {
                    File photo = createImageFile();
                    cameraImageUri = FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".provider", photo);
                    cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri);
                } catch (IOException ignored) {}

                Intent fileIntent = params.createIntent();
                Intent chooser = Intent.createChooser(fileIntent, "फ़ाइल या फोटो चुनें");
                if (cameraIntent != null)
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});

                try {
                    startActivityForResult(chooser, FILE_CHOOSER_CODE);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {

            // Open external URLs (Google Maps, Nominatim, etc.) in device browser
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String host = request.getUrl().getHost() != null ? request.getUrl().getHost() : "";
                // Keep internal server URLs inside WebView
                SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String serverUrl = p.getString(KEY_SERVER, DEFAULT_URL);
                String serverHost = Uri.parse(serverUrl).getHost();
                if (host.equals(serverHost)) return false;
                // Open all external links in phone's browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadingLayout.setVisibility(View.VISIBLE);
                loadingUrl.setText("जोड़ा जा रहा है: " + url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loadingLayout.setVisibility(View.GONE);
                injectGPSBridge(view);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                loadingLayout.setVisibility(View.GONE);
                SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String serverUrl = p.getString(KEY_SERVER, DEFAULT_URL);
                view.loadData(
                    "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>" +
                    "<body style='font-family:sans-serif;text-align:center;padding:40px;background:#f9fafb;margin:0'>" +
                    "<div style='font-size:56px;margin-bottom:16px'>📡</div>" +
                    "<h2 style='color:#e11d48;margin:0 0 12px'>सर्वर से कनेक्ट नहीं हो सका</h2>" +
                    "<p style='color:#6b7280;margin:0 0 8px'>फोन और PC एक ही WiFi पर होने चाहिए</p>" +
                    "<p style='color:#9ca3af;font-size:13px;margin:0 0 24px;word-break:break-all'>URL: " + serverUrl + "</p>" +
                    "<button onclick='location.reload()' style='display:block;width:100%;padding:14px;" +
                    "background:#059669;color:white;border:none;border-radius:12px;font-size:16px;" +
                    "font-weight:bold;margin-bottom:12px'>🔄 पुनः प्रयास करें</button>" +
                    "<p style='color:#9ca3af;font-size:12px'>URL बदलने के लिए Back button दबाए रखें</p>" +
                    "</body></html>",
                    "text/html", "utf-8");
            }
        });

        // Timeout: if page doesn't load in 15 seconds, show error
        handler.postDelayed(() -> {
            if (loadingLayout.getVisibility() == View.VISIBLE) {
                SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String serverUrl = p.getString(KEY_SERVER, DEFAULT_URL);
                loadingLayout.setVisibility(View.GONE);
                webView.loadData(
                    "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>" +
                    "<body style='font-family:sans-serif;text-align:center;padding:40px;background:#f9fafb;margin:0'>" +
                    "<div style='font-size:56px;margin-bottom:16px'>⏱️</div>" +
                    "<h2 style='color:#e11d48;margin:0 0 12px'>कनेक्शन Timeout</h2>" +
                    "<p style='color:#6b7280;margin:0 0 8px'>सर्वर का जवाब नहीं आया</p>" +
                    "<p style='color:#9ca3af;font-size:13px;margin:0 0 24px;word-break:break-all'>URL: " + serverUrl + "</p>" +
                    "<button onclick='location.reload()' style='display:block;width:100%;padding:14px;" +
                    "background:#059669;color:white;border:none;border-radius:12px;font-size:16px;" +
                    "font-weight:bold;margin-bottom:12px'>🔄 पुनः प्रयास करें</button>" +
                    "<p style='color:#9ca3af;font-size:12px'>URL बदलने के लिए Back button दबाए रखें</p>" +
                    "</body></html>",
                    "text/html", "utf-8");
            }
        }, 15000);

        requestAllPermissions();
    }

    private void injectGPSBridge(WebView view) {
        String js =
            "(function(){" +
            "  if(!window.AndroidGPS) return;" +
            "  var geo = navigator.geolocation;" +
            "  var orig = geo.getCurrentPosition.bind(geo);" +
            "  geo.getCurrentPosition = function(success, error, opts) {" +
            "    try {" +
            "      var loc = window.AndroidGPS.getLocation();" +
            "      if(loc && loc !== 'null') {" +
            "        var p = loc.split(',');" +
            "        success({coords:{latitude:+p[0],longitude:+p[1],accuracy:+p[2]," +
            "          altitude:null,altitudeAccuracy:null,heading:null,speed:null}," +
            "          timestamp:Date.now()});" +
            "        return;" +
            "      }" +
            "    } catch(e) {}" +
            "    orig(success, error, opts);" +
            "  };" +
            "})();";
        view.evaluateJavascript(js, null);
    }

    private void requestAllPermissions() {
        List<String> needed = new ArrayList<>();
        for (String p : new String[]{
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA })
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED)
                needed.add(p);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            for (String p : new String[]{
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO })
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED)
                    needed.add(p);
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }

        if (needed.isEmpty()) { startLocationUpdates(); loadPortal(); }
        else ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERM_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != PERM_CODE) return;
        boolean locGranted = false;
        for (int i = 0; i < perms.length; i++)
            if (Manifest.permission.ACCESS_FINE_LOCATION.equals(perms[i])
                    && results[i] == PackageManager.PERMISSION_GRANTED)
                locGranted = true;
        if (locGranted) startLocationUpdates();
        loadPortal();
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        try {
            // GPS_PROVIDER — most accurate, use separate listener
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                Location l = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (l != null) lastGpsLocation = l;
                // Request every 2 seconds, 0 metres — stays fresh for the JS bridge
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0f, gpsListener);
            }
        } catch (Exception ignored) {}
        try {
            // NETWORK_PROVIDER — fallback only
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                Location l = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (l != null) lastNetLocation = l;
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0f, netListener);
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_CODE || filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) results = new Uri[]{data.getData()};
            else if (cameraImageUri != null)             results = new Uri[]{cameraImageUri};
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
        cameraImageUri = null;
    }

    private File createImageFile() throws IOException {
        String ts = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
        return File.createTempFile("IMG_" + ts, ".jpg",
            getExternalFilesDir(Environment.DIRECTORY_PICTURES));
    }

    private void loadPortal() {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String url = p.getString(KEY_SERVER, DEFAULT_URL);
        loadingUrl.setText("जोड़ा जा रहा है: " + url);
        webView.loadUrl(url);
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
        try { locationManager.removeUpdates(gpsListener); } catch (Exception ignored) {}
        try { locationManager.removeUpdates(netListener); } catch (Exception ignored) {}
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) { showServerDialog(); return true; }
        return super.onKeyLongPress(keyCode, event);
    }

    private void showServerDialog() {
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        EditText input = new EditText(this);
        input.setText(prefs.getString(KEY_SERVER, DEFAULT_URL));
        input.setSelectAllOnFocus(true);
        LinearLayout layout = new LinearLayout(this);
        layout.setPadding(48, 24, 48, 0);
        layout.addView(input, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
            .setTitle("सर्वर URL बदलें").setView(layout)
            .setPositiveButton("सहेजें", (d, w) -> {
                String url = input.getText().toString().trim();
                if (!url.isEmpty()) {
                    prefs.edit().putString(KEY_SERVER, url).apply();
                    webView.loadUrl(url);
                    Toast.makeText(this, "URL बदला गया", Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("रद्द करें", null).show();
    }
}

package com.pmtarcade.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * First screen of the app. On the very first start it asks for every permission the app needs in
 * one go (microphone for voice chat, notifications for game invites and results), then opens
 * pmtarcade.com full screen. Later starts open the game straight away.
 */
public class StartActivity extends Activity {
    private static final int ASK_ALL = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SharedPreferences prefs = getSharedPreferences("start", MODE_PRIVATE);
        if (!prefs.getBoolean("asked", false)) {
            List<String> missing = new ArrayList<>();
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.RECORD_AUDIO);
            }
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            prefs.edit().putBoolean("asked", true).apply();
            if (!missing.isEmpty()) {
                requestPermissions(missing.toArray(new String[0]), ASK_ALL);
                return;
            }
        }
        openGame();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        openGame();
    }

    private void openGame() {
        // NEW_TASK: otherwise LauncherActivity restarts itself in a new task, and that second copy
        // sees the first one still alive and closes at once (the app then shows nothing)
        Intent open = new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(open);
        finish();
        overridePendingTransition(0, 0);
    }
}

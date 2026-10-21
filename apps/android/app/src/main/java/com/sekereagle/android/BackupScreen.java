package com.sekereagle.android;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import android.widget.*;
import java.util.*;
import org.json.*;

final class BackupScreen extends ScrollView {
  final String scope;
  private final MainActivity activity;
  private final BackupSettings settings;
  private final LinearLayout panel;
  private TextView status, counts, errors;

  BackupScreen(MainActivity activity, BackupSettings settings, String scope) {
    super(activity);
    this.activity = activity;
    this.settings = settings;
    this.scope = scope;
    setFillViewport(true);
    panel = Ui.panel(activity);
    addView(panel);
    panel.addView(Ui.text(activity, "手机备份", 26));
    panel.addView(Ui.text(activity, "照片、视频、RAW 原文件增量备份", 14));
    if (scope.isEmpty()) {
      panel.addView(Ui.text(activity, "请先连接服务并在图库登录，再选择备份目录。", 16));
      panel.addView(Ui.button(activity, "前往图库登录", () -> activity.show("library")));
      return;
    }
    panel.addView(Ui.text(activity, settings.value(scope, "email", ""), 13));
    status = Ui.text(activity, "", 19);
    counts = Ui.text(activity, "", 14);
    errors = Ui.text(activity, "", 13);
    panel.addView(status);
    panel.addView(counts);
    toggle("启用手机备份", "enabled", false, activity::enable);
    toggle(
        "打开应用时自动扫描并备份",
        "auto",
        false,
        value -> {
          settings.setFlag(scope, "auto", value);
        });
    toggle("仅 Wi-Fi 上传", "wifi", true, value -> settings.setFlag(scope, "wifi", value));
    toggle("仅充电时备份", "charging", false, value -> settings.setFlag(scope, "charging", value));
    LinearLayout actions = new LinearLayout(activity);
    panel.addView(actions);
    actions.addView(
        Ui.button(activity, "立即扫描 / 重试", activity::startBackup),
        new LinearLayout.LayoutParams(0, -2, 1));
    actions.addView(
        Ui.button(activity, "暂停", activity::pause), new LinearLayout.LayoutParams(0, -2, 1));
    panel.addView(Ui.text(activity, "备份目录", 21));
    JSONArray rules = settings.rules(scope);
    if (rules.length() == 0) panel.addView(Ui.text(activity, "尚未选择目录。只扫描你选中的目录。", 14));
    for (int i = 0; i < rules.length(); i++) {
      final int index = i;
      JSONObject rule = rules.optJSONObject(i);
      String location = rule.optString("path");
      if (rule.optString("type").equals("tree"))
        location = Uri.decode(location.substring(location.lastIndexOf('/') + 1));
      String label =
          location
              + "\n"
              + (rule.optString("mode").equals("PHOTO") ? "照片" : "素材")
              + " · "
              + (rule.optBoolean("recursive", true) ? "包含子目录" : "仅此目录");
      panel.addView(Ui.button(activity, label, () -> editRule(index)));
    }
    panel.addView(Ui.button(activity, "选择手机相册目录", () -> activity.loadFolders(this::folderPicker)));
    panel.addView(Ui.button(activity, "添加其他文件夹（系统授权）", activity::pickTree));
    panel.addView(
        Ui.text(
            activity, "下载图片可从手机相册目录中的 Download 选择；未被媒体库收录的 RAW 可尝试通过系统授权添加所在文件夹。目录不可读时会明确提示。", 13));
    panel.addView(Ui.text(activity, "运行设置", 21));
    toggle(
        "专注备份：保持屏幕唤醒",
        "focused",
        false,
        value -> {
          settings.setFlag(scope, "focused", value);
          focus(value);
        });
    panel.addView(
        Ui.button(
            activity,
            "允许显示备份进度通知",
            () -> {
              if (Build.VERSION.SDK_INT >= 33)
                activity.requestPermissions(
                    new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, 74);
            }));
    panel.addView(
        Ui.button(
            activity,
            "小米后台运行设置",
            () -> {
              new AlertDialog.Builder(activity)
                  .setTitle("小米 / HyperOS 设置")
                  .setMessage("建议允许自启动，并将省电策略设为无限制、允许后台联网。不同系统版本的设置位置有所不同。即使被系统结束，下次打开也会接续备份。")
                  .setPositiveButton(
                      "打开应用设置",
                      (d, w) ->
                          activity.startActivity(
                              new Intent(
                                  Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                  Uri.parse("package:" + activity.getPackageName()))))
                  .setNegativeButton("关闭", null)
                  .show();
            }));
    panel.addView(
        Ui.button(
            activity,
            "重新备份全部所选文件",
            () ->
                new AlertDialog.Builder(activity)
                    .setTitle("重新检查全部文件？")
                    .setMessage("清除当前账号在本机的备份回执并重新扫描。服务器已有内容仍会跳过，曾被你从服务器删除的文件可能再次上传。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton(
                        "重新检查",
                        (d, w) -> {
                          if (settings.flag(scope, "running", false)) {
                            activity.toast("请先暂停，并等待当前备份停止");
                            return;
                          }
                          try (BackupJournal journal = new BackupJournal(activity)) {
                            journal.forget(scope);
                          }
                          activity.startBackup();
                        })
                    .show()));
    panel.addView(errors);
    panel.addView(Ui.text(activity, "备份保留原字节，不压缩、不改写文件，不自动删除手机或服务器中的资源。服务器已删除的内容不会因普通扫描反复上传。", 13));
    refreshStatus();
  }

  private void toggle(
      String title, String key, boolean fallback, java.util.function.Consumer<Boolean> changed) {
    CheckBox control = new CheckBox(activity);
    control.setText(title);
    control.setTextColor(Color.WHITE);
    control.setChecked(settings.flag(scope, key, fallback));
    control.setPadding(0, Ui.dp(activity, 6), 0, Ui.dp(activity, 6));
    control.setOnCheckedChangeListener((button, value) -> changed.accept(value));
    panel.addView(control);
  }

  private void focus(boolean enabled) {
    if (enabled) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  void refreshStatus() {
    if (status == null) return;
    status.setText(settings.value(scope, "status", "选择目录后即可开始"));
    counts.setText(settings.value(scope, "counts", "尚未运行备份"));
    JSONArray list;
    try {
      list = new JSONArray(settings.value(scope, "errors", "[]"));
    } catch (Exception e) {
      list = new JSONArray();
    }
    StringBuilder details = new StringBuilder();
    for (int i = 0; i < list.length(); i++) details.append(list.optString(i)).append('\n');
    errors.setText(details);
    focus(settings.flag(scope, "focused", false) && settings.flag(scope, "running", false));
  }

  private void folderPicker(List<String> folders) {
    if (!scope.equals(settings.active())) return;
    if (folders.isEmpty()) {
      activity.toast("未发现支持的媒体，请确认权限或通过系统授权添加目录");
      return;
    }
    boolean[] selected = new boolean[folders.size()];
    JSONArray rules = settings.rules(scope);
    for (int i = 0; i < folders.size(); i++)
      for (int j = 0; j < rules.length(); j++)
        if (rules.optJSONObject(j).optString("type").equals("media")
            && rules.optJSONObject(j).optString("path").equals(folders.get(i))) selected[i] = true;
    new AlertDialog.Builder(activity)
        .setTitle("选择需要备份的目录")
        .setMultiChoiceItems(
            folders.toArray(new String[0]), selected, (d, w, value) -> selected[w] = value)
        .setNegativeButton("取消", null)
        .setPositiveButton(
            "保存",
            (d, w) -> {
              if (!scope.equals(settings.active())) return;
              activity.pause();
              JSONArray next = new JSONArray();
              for (int i = 0; i < rules.length(); i++) {
                JSONObject rule = rules.optJSONObject(i);
                int index = folders.indexOf(rule.optString("path"));
                if (!rule.optString("type").equals("media") || index < 0 || selected[index])
                  next.put(rule);
              }
              settings.rules(scope, next);
              for (int i = 0; i < folders.size(); i++)
                if (selected[i]) addRule(settings, scope, "media", folders.get(i));
              activity.show("backup");
            })
        .show();
  }

  static void addRule(BackupSettings settings, String scope, String type, String path) {
    JSONArray rules = settings.rules(scope);
    for (int i = 0; i < rules.length(); i++)
      if (rules.optJSONObject(i).optString("type").equals(type)
          && rules.optJSONObject(i).optString("path").equals(path)) return;
    try {
      rules.put(
          new JSONObject()
              .put("type", type)
              .put("path", path)
              .put("mode", "PHOTO")
              .put("recursive", true));
      settings.rules(scope, rules);
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
  }

  private void editRule(int index) {
    JSONArray rules = settings.rules(scope);
    JSONObject rule = rules.optJSONObject(index);
    new AlertDialog.Builder(activity)
        .setTitle("目录设置")
        .setItems(
            new String[] {
              "备份到照片", "备份到素材", rule.optBoolean("recursive", true) ? "关闭子目录扫描" : "包含子目录", "移除目录"
            },
            (d, which) -> {
              if (!scope.equals(settings.active())) return;
              activity.pause();
              try {
                if (which == 3) rules.remove(index);
                else if (which == 2) rule.put("recursive", !rule.optBoolean("recursive", true));
                else rule.put("mode", which == 0 ? "PHOTO" : "MATERIAL");
                settings.rules(scope, rules);
                activity.show("backup");
              } catch (JSONException e) {
                activity.toast("设置未保存，请重试");
              }
            })
        .show();
  }
}

package com.sekereagle.android;

import android.content.Intent;
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
    setClipToPadding(false);
    panel = Ui.panel(activity);
    addView(panel);
    if (scope.isEmpty()) {
      LinearLayout welcome = Ui.card(activity, panel);
      Ui.space(welcome, 12);
      welcome.addView(Ui.icon(activity, R.drawable.ic_cloud, Ui.ACCENT, 40));
      Ui.space(welcome, 20);
      welcome.addView(Ui.text(activity, "为手机原片留一份备份", 24));
      Ui.space(welcome, 10);
      welcome.addView(Ui.muted(activity, "先登录你的图库，再选择想要备份的文件夹。", 14));
      Ui.space(welcome, 24);
      welcome.addView(
          Ui.button(activity, "前往登录", () -> activity.show("library")),
          new LinearLayout.LayoutParams(-1, Ui.dp(activity, 48)));
      return;
    }
    LinearLayout summary = Ui.card(activity, panel);
    LinearLayout headline = new LinearLayout(activity);
    headline.setGravity(android.view.Gravity.CENTER_VERTICAL);
    headline.addView(Ui.icon(activity, R.drawable.ic_cloud, Ui.ACCENT, 32));
    LinearLayout labels = new LinearLayout(activity);
    labels.setOrientation(LinearLayout.VERTICAL);
    labels.setPadding(Ui.dp(activity, 14), 0, 0, 0);
    status = Ui.text(activity, "", 21);
    counts = Ui.muted(activity, "", 12);
    labels.addView(status);
    Ui.space(labels, 5);
    labels.addView(counts);
    headline.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    summary.addView(headline);
    Ui.space(summary, 20);
    LinearLayout actions = new LinearLayout(activity);
    actions.setGravity(android.view.Gravity.CENTER_VERTICAL);
    primary = Ui.button(activity, "立即备份", activity::startBackup);
    primary.setIconResource(R.drawable.ic_cloud);
    actions.addView(primary, new LinearLayout.LayoutParams(0, Ui.dp(activity, 48), 1));
    pause = Ui.iconButton(activity, R.drawable.ic_pause, "暂停备份", activity::pause);
    LinearLayout.LayoutParams pauseParams =
        new LinearLayout.LayoutParams(Ui.dp(activity, 48), Ui.dp(activity, 48));
    pauseParams.leftMargin = Ui.dp(activity, 8);
    actions.addView(pause, pauseParams);
    summary.addView(actions);
    Ui.section(panel, "自动备份");
    LinearLayout automation = Ui.card(activity, panel);
    toggle(automation, "启用手机备份", "将原文件保存到当前账号", "enabled", false, activity::enable);
    Ui.divider(automation);
    toggle(
        automation,
        "打开时自动备份",
        "进入应用后检查新增照片和视频",
        "auto",
        false,
        value -> settings.setFlag(scope, "auto", value));
    Ui.section(panel, "备份文件夹");
    LinearLayout folders = Ui.card(activity, panel);
    JSONArray rules = settings.rules(scope);
    if (rules.length() == 0) {
      folders.addView(Ui.row(activity, R.drawable.ic_folder, "选择想备份的文件夹", "仅检查你选中的目录", null));
    }
    for (int i = 0; i < rules.length(); i++) {
      final int index = i;
      JSONObject rule = rules.optJSONObject(i);
      String location = rule.optString("path");
      if (rule.optString("type").equals("tree"))
        location = Uri.decode(location.substring(location.lastIndexOf('/') + 1));
      String trimmed = location.replaceAll("/+$", "");
      String title =
          trimmed.substring(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':')) + 1);
      String detail =
          (rule.optString("mode").equals("PHOTO") ? "照片" : "素材")
              + " · "
              + (rule.optBoolean("recursive", true) ? "包含子文件夹" : "仅此文件夹");
      folders.addView(Ui.row(activity, R.drawable.ic_folder, title, detail, () -> editRule(index)));
      if (i < rules.length() - 1) Ui.divider(folders);
    }
    Ui.space(folders, 12);
    LinearLayout add = new LinearLayout(activity);
    add.addView(
        Ui.secondary(activity, "手机相册", () -> activity.loadFolders(this::folderPicker)),
        new LinearLayout.LayoutParams(0, Ui.dp(activity, 44), 1));
    LinearLayout.LayoutParams extra = new LinearLayout.LayoutParams(0, Ui.dp(activity, 44), 1);
    extra.leftMargin = Ui.dp(activity, 8);
    add.addView(Ui.secondary(activity, "其他文件夹", activity::pickTree), extra);
    folders.addView(add);
    Ui.section(panel, "备份条件");
    LinearLayout conditions = Ui.card(activity, panel);
    toggle(
        conditions,
        "仅 Wi-Fi 上传",
        "避免使用移动数据",
        "wifi",
        true,
        value -> settings.setFlag(scope, "wifi", value));
    Ui.divider(conditions);
    toggle(
        conditions,
        "仅充电时备份",
        "连接电源后再上传",
        "charging",
        false,
        value -> settings.setFlag(scope, "charging", value));
    Ui.divider(conditions);
    toggle(
        conditions,
        "专注备份",
        "备份页保持屏幕唤醒",
        "focused",
        false,
        value -> {
          settings.setFlag(scope, "focused", value);
          focus(value);
        });
    LinearLayout more = Ui.card(activity, panel);
    more.addView(
        Ui.row(activity, R.drawable.ic_settings, "更多设置", "后台运行、进度通知与重新校验", this::showMore));
    errors = Ui.muted(activity, "", 12);
    errors.setPadding(Ui.dp(activity, 4), 0, Ui.dp(activity, 4), Ui.dp(activity, 12));
    panel.addView(errors);
    panel.addView(
        Ui.row(activity, R.drawable.ic_shield, "保留原始品质", "照片 · 视频 · RAW，不压缩、不自动删除", null));
    refreshStatus();
  }

  private com.google.android.material.button.MaterialButton primary;
  private ImageButton pause;

  private void toggle(
      LinearLayout container,
      String title,
      String subtitle,
      String key,
      boolean fallback,
      java.util.function.Consumer<Boolean> changed) {
    LinearLayout row = new LinearLayout(activity);
    row.setGravity(android.view.Gravity.CENTER_VERTICAL);
    row.setPadding(0, Ui.dp(activity, 10), 0, Ui.dp(activity, 10));
    row.setMinimumHeight(Ui.dp(activity, 62));
    LinearLayout labels = new LinearLayout(activity);
    labels.setOrientation(LinearLayout.VERTICAL);
    labels.addView(Ui.text(activity, title, 14));
    Ui.space(labels, 4);
    labels.addView(Ui.muted(activity, subtitle, 12));
    row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    com.google.android.material.materialswitch.MaterialSwitch control =
        new com.google.android.material.materialswitch.MaterialSwitch(activity);
    control.setContentDescription(title);
    control.setTag("backup-" + key);
    control.setChecked(settings.flag(scope, key, fallback));
    control.setOnCheckedChangeListener((button, value) -> changed.accept(value));
    row.addView(control);
    row.setOnClickListener(v -> control.toggle());
    container.addView(row);
  }

  private void showMore() {
    com.google.android.material.bottomsheet.BottomSheetDialog sheet =
        new com.google.android.material.bottomsheet.BottomSheetDialog(activity);
    LinearLayout content = Ui.panel(activity);
    content.setBackgroundColor(Ui.SURFACE);
    content.addView(Ui.text(activity, "备份设置", 20));
    Ui.space(content, 12);
    content.addView(
        Ui.row(
            activity,
            R.drawable.ic_cloud,
            "进度通知",
            "在通知栏查看上传状态",
            () -> {
              sheet.dismiss();
              if (Build.VERSION.SDK_INT >= 33)
                activity.requestPermissions(
                    new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, 74);
            }));
    Ui.divider(content);
    content.addView(
        Ui.row(
            activity,
            R.drawable.ic_plug,
            "后台运行",
            "小米 / HyperOS 电池与自启动设置",
            () -> {
              sheet.dismiss();
              new com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
                  .setTitle("允许后台运行")
                  .setMessage("建议开启自启动、允许后台联网，并将省电策略设为无限制。不同系统版本的设置位置可能不同。")
                  .setPositiveButton(
                      "打开应用设置",
                      (d, w) ->
                          activity.startActivity(
                              new Intent(
                                  Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                  Uri.parse("package:" + activity.getPackageName()))))
                  .setNegativeButton("取消", null)
                  .show();
            }));
    Ui.divider(content);
    content.addView(
        Ui.row(
            activity,
            R.drawable.ic_folder,
            "文件夹说明",
            "下载的图片与未收录的 RAW",
            () ->
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
                    .setTitle("选择备份目录")
                    .setMessage("下载图片可在手机相册目录中选择 Download。未进入媒体库的 RAW 可通过系统选择器授权所在目录。只有选择的目录会参与备份。")
                    .setPositiveButton("知道了", null)
                    .show()));
    Ui.divider(content);
    content.addView(
        Ui.row(
            activity,
            R.drawable.ic_settings,
            "重新检查全部文件",
            "清除本机回执，重新校验所选目录",
            () -> {
              sheet.dismiss();
              new com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
                  .setTitle("重新检查全部文件？")
                  .setMessage("服务器已有内容仍会跳过，曾从服务器删除的文件可能再次上传。")
                  .setNegativeButton("取消", null)
                  .setPositiveButton(
                      "重新检查",
                      (d, w) -> {
                        if (settings.flag(scope, "running", false)) {
                          activity.toast("请先暂停当前备份");
                          return;
                        }
                        try (BackupJournal journal = new BackupJournal(activity)) {
                          journal.forget(scope);
                        }
                        activity.startBackup();
                      })
                  .show();
            }));
    Ui.space(content, 20);
    sheet.setContentView(content);
    sheet.show();
  }

  private void focus(boolean enabled) {
    if (enabled) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  void refreshStatus() {
    if (status == null) return;
    status.setText(settings.value(scope, "status", "选择目录后即可开始"));
    counts.setText(settings.value(scope, "counts", "原片备份 · 尚未开始"));
    boolean running = settings.flag(scope, "running", false);
    primary.setText(running ? "正在备份…" : "立即备份");
    primary.setEnabled(!running);
    pause.setVisibility(running ? VISIBLE : GONE);
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
    new com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
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
    new com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
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

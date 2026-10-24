package com.sekereagle.android;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.widget.*;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.sekereagle.android.core.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ExecutorService;
import org.json.*;

/** Explicit, short-lived cleanup plans. No server delete API is used. */
final class CleanupScreen extends ScrollView {
  static final int DELETE_REQUEST = 76;
  private final MainActivity activity;
  private final BackupSettings settings;
  private final String scope;
  private final ExecutorService io;
  private final TextView status, detail;
  private final com.google.android.material.button.MaterialButton action;
  private List<Entry> plan = Collections.emptyList(),
      pendingDocuments = Collections.emptyList(),
      pendingMedia = Collections.emptyList();
  private long plannedAt;
  private volatile int generation;
  private boolean busy;

  private static final class Entry {
    final MediaCatalog.Item item;
    final String mode, hash;

    Entry(MediaCatalog.Item item, String mode, String hash) {
      this.item = item;
      this.mode = mode;
      this.hash = hash;
    }
  }

  CleanupScreen(MainActivity activity, BackupSettings settings, String scope, ExecutorService io) {
    super(activity);
    this.activity = activity;
    this.settings = settings;
    this.scope = scope;
    this.io = io;
    LinearLayout panel = Ui.panel(activity);
    addView(panel);
    LinearLayout card = Ui.card(activity, panel);
    card.addView(Ui.icon(activity, R.drawable.ic_cloud, Ui.ACCENT, 32));
    Ui.space(card, 18);
    status = Ui.text(activity, "保留备份，腾出手机空间", 23);
    card.addView(status);
    Ui.space(card, 12);
    detail = Ui.muted(activity, "检查所选备份目录，只有服务器仍有备份且手机文件未变化的原文件才会列入清理。", 14);
    card.addView(detail);
    Ui.space(card, 24);
    action = Ui.button(activity, "检查可释放空间", this::activate);
    action.setTag("cleanup-action");
    card.addView(action, new LinearLayout.LayoutParams(-1, Ui.dp(activity, 48)));
    panel.addView(Ui.row(activity, R.drawable.ic_shield, "服务器备份会保留", "不会自动清理，不会删除服务器上的文件", null));
    panel.addView(
        Ui.row(
            activity,
            R.drawable.ic_folder,
            settings.flag(scope, "allMedia", false) ? "仅检查全部手机媒体" : "仅检查所选目录",
            "未备份、已变化或无法确认的文件会保留",
            null));
  }

  private void guard(int token) throws IOException {
    if (token != generation
        || !isAttachedToWindow()
        || scope.isEmpty()
        || !scope.equals(settings.active())
        || settings.flag(scope, "running", false)) throw new IOException("清理已取消，请确认账号和备份状态后重新检查");
  }

  private SessionApi identity(int token) throws Exception {
    guard(token);
    SessionApi api = activity.sessionApi();
    JSONObject me = api.request("GET", "/api/auth/me", null);
    if (!me.getJSONObject("user").getString("id").equals(settings.value(scope, "owner", ""))
        || !me.getJSONObject("desktopCache")
            .getString("deploymentId")
            .equals(settings.value(scope, "deployment", "")))
      throw new IOException("账号或服务已变化，请重新检查");
    guard(token);
    return api;
  }

  private CleanupEngine engine(BackupJournal journal, SessionApi api, int token) {
    return new CleanupEngine(
        journal,
        (mode, hash, size) ->
            api.request(
                    "POST",
                    "/api/"
                        + (mode.equals("PHOTO") ? "photos" : "eagle")
                        + "/uploads/check-content",
                    new JSONObject().put("contentSha256", hash).put("size", size))
                .getBoolean("exists"),
        () -> guard(token));
  }

  private BackupEngine.File source(MediaCatalog catalog, MediaCatalog.Item item, int token) {
    return new BackupEngine.File(
        item.uri.toString(),
        item.size,
        item.modified,
        () -> catalog.hash(item, () -> guard(token)),
        () -> catalog.stable(item));
  }

  private boolean writableDocument(MediaCatalog.Item item) {
    return !item.document
        || activity.checkUriPermission(
                item.uri,
                android.os.Process.myPid(),
                android.os.Process.myUid(),
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            == PackageManager.PERMISSION_GRANTED;
  }

  private void activate() {
    if (busy) return;
    if (settings.flag(scope, "running", false)) {
      activity.toast("请先暂停备份，再检查释放空间");
      return;
    }
    if (plan.isEmpty()) {
      scan();
      return;
    }
    if (System.currentTimeMillis() - plannedAt > 60_000) {
      reset("检查结果已过期，请重新检查");
      return;
    }
    new MaterialAlertDialogBuilder(activity)
        .setTitle("释放手机空间？")
        .setMessage(
            "将删除手机中的 " + plan.size() + " 个原文件，约 " + size(plan) + "。服务器备份会保留。安卓可能继续要求系统确认，取消不会清理文件。")
        .setNegativeButton("取消", (d, w) -> reset("已取消，手机文件保留"))
        .setPositiveButton("继续", (d, w) -> prepareDeletion())
        .show();
  }

  private void scan() {
    if (scope.isEmpty()) {
      activity.toast("请先登录并完成备份");
      return;
    }
    if (activity.hasMediaRules(scope) && !activity.mediaPermission()) {
      activity.requestMediaPermission();
      return;
    }
    busy = true;
    action.setEnabled(false);
    status.setText("正在核对备份");
    detail.setText("正在重新检查文件内容和服务器副本…");
    final int token = ++generation;
    io.execute(
        () -> {
          try (BackupJournal journal = new BackupJournal(activity)) {
            SessionApi api = identity(token);
            MediaCatalog catalog = new MediaCatalog(activity);
            CleanupEngine engine = engine(journal, api, token);
            Map<String, Entry> entries = new LinkedHashMap<>();
            catalog.scan(
                settings.scanRules(scope),
                (item, mode) -> {
                  guard(token);
                  if (entries.size() >= 500
                      || entries.containsKey(item.uri.toString())
                      || !writableDocument(item)) return;
                  try {
                    catalog.checkSize(item);
                  } catch (Exception unusable) {
                    // Keep the file; one unsupported or empty item must not abort the plan.
                    guard(token);
                    return;
                  }
                  CleanupEngine.Candidate candidate =
                      engine.check(scope, mode, source(catalog, item, token));
                  if (candidate != null)
                    entries.put(item.uri.toString(), new Entry(item, mode, candidate.hash));
                },
                () -> guard(token));
            guard(token);
            activity.runOnUiThread(
                () -> {
                  if (token != generation || !isAttachedToWindow()) return;
                  busy = false;
                  plan = new ArrayList<>(entries.values());
                  plannedAt = System.currentTimeMillis();
                  status.setText(plan.isEmpty() ? "暂无可释放的空间" : "可释放 " + size(plan));
                  detail.setText(
                      plan.isEmpty()
                          ? "未备份、文件已变化、服务器副本无法确认或目录不可写的项目会保留。"
                          : "已确认 "
                              + plan.size()
                              + " 个原文件有服务器备份。继续后会再检查一次，确认删除前可取消。每次最多清理 500 项，可重复检查。");
                  action.setEnabled(true);
                  action.setText(plan.isEmpty() ? "重新检查" : "释放 " + size(plan));
                });
          } catch (Exception e) {
            fail(token, e);
          }
        });
  }

  private List<Entry> validate(List<Entry> entries, int token) throws Exception {
    SessionApi api = identity(token);
    MediaCatalog catalog = new MediaCatalog(activity);
    List<Entry> result = new ArrayList<>();
    try (BackupJournal journal = new BackupJournal(activity)) {
      CleanupEngine engine = engine(journal, api, token);
      for (Entry entry : entries) {
        guard(token);
        CleanupEngine.Candidate checked =
            engine.check(scope, entry.mode, source(catalog, entry.item, token));
        if (checked == null || !checked.hash.equals(entry.hash) || !writableDocument(entry.item))
          throw new IOException("文件或备份状态已变化，未继续删除，请重新检查");
        result.add(entry);
      }
    }
    return result;
  }

  private void prepareDeletion() {
    if (System.currentTimeMillis() - plannedAt > 60_000) {
      reset("检查结果已过期，请重新检查");
      return;
    }
    busy = true;
    action.setEnabled(false);
    status.setText("正在进行最后核对");
    final int token = ++generation;
    final List<Entry> snapshot = new ArrayList<>(plan);
    io.execute(
        () -> {
          try {
            List<Entry> checked = validate(snapshot, token);
            List<Uri> media = new ArrayList<>();
            List<Entry> mediaEntries = new ArrayList<>();
            List<Entry> documents = new ArrayList<>();
            for (Entry entry : checked) {
              if (entry.item.document) documents.add(entry);
              else {
                media.add(entry.item.uri);
                mediaEntries.add(entry);
              }
            }
            PendingIntent request =
                media.isEmpty()
                    ? null
                    : MediaStore.createDeleteRequest(activity.getContentResolver(), media);
            guard(token);
            activity.runOnUiThread(
                () -> {
                  try {
                    guard(token);
                    pendingDocuments = documents;
                    pendingMedia = mediaEntries;
                    if (request != null)
                      activity.startIntentSenderForResult(
                          request.getIntentSender(), DELETE_REQUEST, null, 0, 0, 0);
                    else deleteDocuments(token, documents);
                  } catch (Exception e) {
                    fail(token, e);
                  }
                });
          } catch (Exception e) {
            fail(token, e);
          }
        });
  }

  void onDeleteResult(int result) {
    if (result != Activity.RESULT_OK) {
      reset("已取消，未继续清理手机文件");
      return;
    }
    deleteDocuments(generation, pendingDocuments);
  }

  private void deleteDocuments(int token, List<Entry> entries) {
    io.execute(
        () -> {
          try {
            for (Entry entry : pendingMedia) {
              guard(token);
              try (android.database.Cursor cursor =
                  activity
                      .getContentResolver()
                      .query(entry.item.uri, new String[] {"_id"}, null, null, null)) {
                if (cursor == null || cursor.moveToFirst())
                  throw new IOException("部分手机文件尚未清理，请重新检查");
              }
            }
            if (!entries.isEmpty())
              for (Entry entry : entries) {
                validate(Collections.singletonList(entry), token);
                guard(token);
                if (!DocumentsContract.deleteDocument(
                    activity.getContentResolver(), entry.item.uri))
                  throw new IOException("部分文件未能清理，请重新检查");
              }
            activity.runOnUiThread(
                () -> {
                  if (token == generation && isAttachedToWindow()) reset("清理完成，服务器备份已保留");
                });
          } catch (Exception e) {
            fail(token, e);
          }
        });
  }

  private String size(List<Entry> entries) {
    long bytes = 0;
    for (Entry entry : entries) bytes += entry.item.size;
    return android.text.format.Formatter.formatShortFileSize(activity, bytes);
  }

  private void reset(String message) {
    generation++;
    busy = false;
    plan = Collections.emptyList();
    pendingDocuments = Collections.emptyList();
    pendingMedia = Collections.emptyList();
    status.setText(message);
    detail.setText("可再次检查所选备份目录。服务器备份不会被删除。");
    action.setEnabled(true);
    action.setText("检查可释放空间");
  }

  private void fail(int token, Exception error) {
    activity.runOnUiThread(
        () -> {
          if (token == generation && isAttachedToWindow())
            reset(
                error instanceof ApiClient.Failure
                    ? error.getMessage()
                    : "检查或清理未全部完成，请重新检查。服务器备份仍会保留");
        });
  }

  @Override
  protected void onDetachedFromWindow() {
    generation++;
    plan = Collections.emptyList();
    pendingDocuments = Collections.emptyList();
    pendingMedia = Collections.emptyList();
    super.onDetachedFromWindow();
  }
}

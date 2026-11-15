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
  static final int MAX_BATCH_ITEMS = 500;
  static final long MAX_BATCH_BYTES = 10L * 1000 * 1000 * 1000;
  private static final int[] FILTER_DAYS = {0, 7, 20, 30, 90};
  private static final String[] FILTER_LABELS = {"全部文件", "7 天前", "20 天前", "30 天前", "90 天前"};

  private final MainActivity activity;
  private final BackupSettings settings;
  private final String scope;
  private final ExecutorService io;
  private final TextView status, detail;
  private final com.google.android.material.button.MaterialButton action, cancel;
  private final Spinner filter;
  private final CleanupSession session;
  private List<Entry> plan;
  private int filterDays;
  private volatile int generation;
  private boolean busy;
  private boolean planConfirmed;
  private boolean syncingFilter;
  private long lastProgressAt;

  static final class Entry {
    final MediaCatalog.Item item;
    final String mode, hash;

    Entry(MediaCatalog.Item item, String mode, String hash) {
      this.item = item;
      this.mode = mode;
      this.hash = hash;
    }
  }

  CleanupScreen(
      MainActivity activity,
      BackupSettings settings,
      String scope,
      ExecutorService io,
      CleanupSession session) {
    super(activity);
    this.activity = activity;
    this.settings = settings;
    this.scope = scope;
    this.io = io;
    this.session = session;
    if (!session.scope.isEmpty() && !session.scope.equals(scope)) session.clear();
    filterDays = knownFilter(session.filterDays);
    plan = new ArrayList<>(session.plan);
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
    Ui.space(card, 18);
    TextView filterLabel = Ui.muted(activity, "只释放", 13);
    card.addView(filterLabel);
    filter = new Spinner(activity);
    ArrayAdapter<String> adapter =
        new ArrayAdapter<>(activity, android.R.layout.simple_spinner_item, FILTER_LABELS);
    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
    filter.setAdapter(adapter);
    syncingFilter = true;
    filter.setSelection(filterIndex(filterDays), false);
    syncingFilter = false;
    filter.setOnItemSelectedListener(
        new AdapterView.OnItemSelectedListener() {
          @Override
          public void onItemSelected(AdapterView<?> parent, android.view.View view, int position, long id) {
            if (syncingFilter) return;
            int selected = FILTER_DAYS[position];
            if (selected == filterDays) return;
            if (busy) {
              syncingFilter = true;
              filter.setSelection(filterIndex(filterDays), false);
              syncingFilter = false;
              return;
            }
            filterDays = selected;
            session.filterDays = selected;
            plan = new ArrayList<>();
            session.plan = new ArrayList<>();
            planConfirmed = false;
            status.setText("筛选条件已更改");
            detail.setText("请重新检查可释放空间。筛选：" + filterLabel() + "。");
            action.setText("检查可释放空间");
            action.setEnabled(true);
          }

          @Override
          public void onNothingSelected(AdapterView<?> parent) {}
        });
    card.addView(filter);
    Ui.space(card, 20);
    action = Ui.button(activity, "检查可释放空间", this::activate);
    action.setTag("cleanup-action");
    card.addView(action, new LinearLayout.LayoutParams(-1, Ui.dp(activity, 48)));
    cancel = Ui.button(activity, "取消本次操作", this::cancelWork);
    cancel.setVisibility(GONE);
    card.addView(cancel, new LinearLayout.LayoutParams(-1, Ui.dp(activity, 44)));
    panel.addView(Ui.row(activity, R.drawable.ic_shield, "服务器备份会保留", "不会自动清理，不会删除服务器上的文件", null));
    panel.addView(
        Ui.row(
            activity,
            R.drawable.ic_folder,
            settings.flag(scope, "allMedia", false) ? "仅检查全部手机媒体" : "仅检查所选目录",
            "未备份、已变化或无法确认的文件会保留",
            null));
    restorePlan();
  }

  private static int knownFilter(int value) {
    for (int days : FILTER_DAYS) if (days == value) return value;
    return 0;
  }

  private static int filterIndex(int days) {
    for (int i = 0; i < FILTER_DAYS.length; i++) if (FILTER_DAYS[i] == days) return i;
    return 0;
  }

  private String filterLabel() {
    return filterDays == 0 ? "全部文件" : filterDays + " 天前的文件（按文件日期）";
  }

  private void restorePlan() {
    if (plan.isEmpty()) {
      action.setText("检查可释放空间");
      return;
    }
    status.setText("可释放 " + size(plan));
    detail.setText(planDetail());
    action.setText("释放 " + size(plan));
  }

  private String planDetail() {
    return "筛选：" + filterLabel() + "；已确认 " + plan.size() + " 个原文件有服务器备份，共约 "
        + size(plan) + "，分 " + batchCount(plan) + " 批释放（每批最多 "
        + MAX_BATCH_ITEMS + " 个 / " + android.text.format.Formatter.formatShortFileSize(activity, MAX_BATCH_BYTES)
        + "）。";
  }

  private void guard(int token) throws IOException {
    if (token != generation
        || !isAttachedToWindow()
        || scope.isEmpty()
        || !scope.equals(settings.active())
        || settings.flag(scope, "running", false)) throw new IOException("操作已取消，请确认账号和备份状态后重试");
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

  private CleanupEngine engine(BackupJournal journal, int token) {
    // local() trusts the confirmed receipt and the file's size/modified time; the batch
    // request below confirms server visibility without reading every original twice.
    return new CleanupEngine(journal, (mode, hash, size) -> true, () -> guard(token));
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
      session.clear();
      plan = new ArrayList<>();
      scan();
      return;
    }
    session.plan = new ArrayList<>(plan);
    session.scope = scope;
    if (planConfirmed) {
      prepareBatch();
      return;
    }
    new MaterialAlertDialogBuilder(activity)
        .setTitle("释放手机空间？")
        .setMessage(
            "将从手机删除 "
                + plan.size()
                + " 个原文件，约 "
                + size(plan)
                + "，分 "
                + batchCount(plan)
                + " 批进行。服务器备份会保留。")
        .setNegativeButton("取消", (d, w) -> activity.toast("已取消，手机文件保留"))
        .setPositiveButton(
            "继续",
            (d, w) -> {
              planConfirmed = true;
              prepareBatch();
            })
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
    cancel.setVisibility(VISIBLE);
    status.setText("正在检查可释放空间");
    detail.setText("筛选：" + filterLabel() + "；正在核对备份记录和服务器副本…");
    final int token = ++generation;
    final long now = System.currentTimeMillis();
    io.execute(
        () -> {
          try (BackupJournal journal = new BackupJournal(activity)) {
            SessionApi api = identity(token);
            MediaCatalog catalog = new MediaCatalog(activity);
            CleanupEngine engine = engine(journal, token);
            List<Entry> found = new ArrayList<>();
            long[] scanned = {0};
            catalog.scan(
                settings.scanRules(scope),
                (item, mode) -> {
                  guard(token);
                  scanned[0]++;
                  if (!CleanupPolicy.olderThan(item.modified, filterDays, now)
                      || !writableDocument(item)
                      // The system delete request only accepts image/video/audio items.
                      || (!item.document && item.deleteUri == null)) return;
                  try {
                    catalog.checkSize(item);
                  } catch (Exception unusable) {
                    guard(token);
                    return;
                  }
                  CleanupEngine.Candidate candidate =
                      engine.local(scope, mode, source(catalog, item, token));
                  if (candidate != null) found.add(new Entry(item, mode, candidate.hash));
                  progress(token, "已扫描 " + scanned[0] + " 个，已确认 " + found.size() + " 个");
                },
                () -> guard(token));
            List<Entry> existing = existingOnly(api, found, token);
            guard(token);
            activity.runOnUiThread(
                () -> {
                  if (token != generation || !isAttachedToWindow()) return;
                  busy = false;
                  cancel.setVisibility(GONE);
                  plan = new ArrayList<>(existing);
                  planConfirmed = false;
                  session.scope = scope;
                  session.filterDays = filterDays;
                  session.plan = new ArrayList<>(plan);
                  if (plan.isEmpty()) {
                    status.setText("暂无可释放的空间");
                    detail.setText(
                        "没有找到同时满足“已确认服务器备份、文件未变化、可写、"
                            + filterLabel()
                            + "”的项目。可调整筛选后重新检查。");
                    action.setText("重新检查");
                  } else {
                    status.setText("可释放 " + size(plan));
                    detail.setText(planDetail());
                    action.setText("释放 " + size(plan));
                  }
                  action.setEnabled(true);
                });
          } catch (Exception e) {
            fail(token, e);
          }
        });
  }

  /** One batch request per 500 items and mode; never per file. */
  private List<Entry> existingOnly(SessionApi api, List<Entry> candidates, int token) throws Exception {
    if (candidates.isEmpty()) return Collections.emptyList();
    Map<String, List<Entry>> byMode = new LinkedHashMap<>();
    for (Entry entry : candidates)
      byMode.computeIfAbsent(entry.mode, key -> new ArrayList<>()).add(entry);
    Set<String> existingUris = new HashSet<>();
    int checked = 0;
    for (Map.Entry<String, List<Entry>> group : byMode.entrySet()) {
      List<Entry> rows = group.getValue();
      for (int start = 0; start < rows.size(); start += MAX_BATCH_ITEMS) {
        guard(token);
        List<Entry> chunk = rows.subList(start, Math.min(rows.size(), start + MAX_BATCH_ITEMS));
        JSONArray items = new JSONArray();
        for (Entry entry : chunk)
          items.put(new JSONObject().put("contentSha256", entry.hash).put("size", entry.item.size));
        JSONObject result =
            api.request(
                "POST",
                "/api/"
                    + (group.getKey().equals("PHOTO") ? "photos" : "eagle")
                    + "/uploads/check-content-batch",
                new JSONObject().put("items", items));
        JSONArray exists = result.getJSONArray("exists");
        if (exists == null || exists.length() != chunk.size())
          throw new IOException("服务器返回的核对结果不完整，请重试");
        for (int index = 0; index < chunk.size(); index++)
          if (exists.optBoolean(index)) existingUris.add(chunk.get(index).item.uri.toString());
        checked += chunk.size();
        progress(token, "正在确认服务器副本 " + checked + "/" + candidates.size());
      }
    }
    guard(token);
    List<Entry> result = new ArrayList<>();
    for (Entry entry : candidates)
      if (existingUris.contains(entry.item.uri.toString())) result.add(entry);
    return result;
  }

  private void prepareBatch() {
    final List<Entry> batch =
        new ArrayList<>(
            CleanupPolicy.nextBatch(
                plan, entry -> entry.item.size, MAX_BATCH_ITEMS, MAX_BATCH_BYTES));
    if (batch.isEmpty()) {
      finishAll();
      return;
    }
    busy = true;
    action.setEnabled(false);
    cancel.setVisibility(VISIBLE);
    status.setText("正在核对本批");
    detail.setText("本批 " + batch.size() + " 个，约 " + size(batch) + "；正在确认服务器副本…");
    final int token = ++generation;
    io.execute(
        () -> {
          try {
            SessionApi api = identity(token);
            MediaCatalog catalog = new MediaCatalog(activity);
            try (BackupJournal journal = new BackupJournal(activity)) {
              CleanupEngine engine = engine(journal, token);
              Set<String> existing = existingUris(api, batch, token);
              List<Entry> valid = new ArrayList<>();
              int skipped = 0;
              for (Entry entry : batch) {
                guard(token);
                // Read the current batch once and verify its content hash before asking
                // the system to delete anything. The plan itself never reads whole files.
                CleanupEngine.Candidate checked =
                    engine.check(scope, entry.mode, source(catalog, entry.item, token));
                if (checked != null
                    && checked.hash.equals(entry.hash)
                    && writableDocument(entry.item)
                    && existing.contains(entry.item.uri.toString())) valid.add(entry);
                else skipped++;
              }
              List<Entry> invalid = new ArrayList<>(batch);
              invalid.removeAll(valid);
              int skippedCount = skipped;
              activity.runOnUiThread(
                  () -> {
                    if (token != generation || !isAttachedToWindow()) return;
                    if (!invalid.isEmpty()) {
                      plan.removeAll(invalid);
                      session.plan = new ArrayList<>(plan);
                    }
                    busy = false;
                    cancel.setVisibility(GONE);
                    if (valid.isEmpty()) {
                      if (plan.isEmpty()) {
                        reset("没有可安全释放的文件", "文件或备份状态已变化，请重新检查。");
                      } else {
                        status.setText("本批没有可安全释放的文件");
                        detail.setText(
                            "已跳过 "
                                + skippedCount
                                + " 个变化或无法确认的项目；剩余 "
                                + plan.size()
                                + " 个，约 "
                                + size(plan)
                                + "。可继续释放下一批。");
                        action.setText("继续释放剩余 " + plan.size() + " 个");
                        action.setEnabled(true);
                        planConfirmed = true;
                      }
                      return;
                    }
                    startDeletion(valid, token);
                  });
            }
          } catch (Exception e) {
            fail(token, e);
          }
        });
  }

  private Set<String> existingUris(SessionApi api, List<Entry> entries, int token) throws Exception {
    List<Entry> existing = existingOnly(api, entries, token);
    Set<String> uris = new HashSet<>();
    for (Entry entry : existing) uris.add(entry.item.uri.toString());
    return uris;
  }

  private void startDeletion(List<Entry> entries, int token) {
    busy = true;
    action.setEnabled(false);
    cancel.setVisibility(VISIBLE);
    List<Uri> media = new ArrayList<>();
    List<Entry> mediaEntries = new ArrayList<>();
    List<Entry> documents = new ArrayList<>();
    for (Entry entry : entries) {
      if (entry.item.document) documents.add(entry);
      else {
        media.add(entry.item.deleteUri);
        mediaEntries.add(entry);
      }
    }
    session.pendingBatch = new ArrayList<>(entries);
    session.pendingMedia = new ArrayList<>(mediaEntries);
    session.pendingDocuments = new ArrayList<>(documents);
    try {
      PendingIntent request =
          media.isEmpty()
              ? null
              : MediaStore.createDeleteRequest(activity.getContentResolver(), media);
      guard(token);
      if (request != null)
        activity.startIntentSenderForResult(request.getIntentSender(), DELETE_REQUEST, null, 0, 0, 0);
      else deleteDocuments(token, documents, 0, new ArrayList<>(), 0);
    } catch (Exception e) {
      fail(token, e);
    }
  }

  void onDeleteResult(int result) {
    if (result != Activity.RESULT_OK) {
      busy = false;
      cancel.setVisibility(GONE);
      action.setEnabled(true);
      planConfirmed = false;
      session.clearPending();
      status.setText("已取消，本批未删除");
      detail.setText("清理计划已保留，可继续释放剩余 " + plan.size() + " 个。");
      if (plan.isEmpty()) reset("已取消");
      else action.setText("继续释放剩余 " + plan.size() + " 个");
      return;
    }
    final int token = generation;
    final List<Entry> media = new ArrayList<>(session.pendingMedia);
    final List<Entry> documents = new ArrayList<>(session.pendingDocuments);
    io.execute(
        () -> {
          int released = 0, movedToTrash = 0;
          List<Entry> kept = new ArrayList<>();
          for (Entry entry : media) {
            try (android.database.Cursor cursor =
                activity
                    .getContentResolver()
                    .query(entry.item.uri, new String[] {"_id", "is_trashed"}, null, null, null)) {
              if (cursor == null) {
                kept.add(entry);
              } else if (!cursor.moveToFirst()) {
                // The provider removed the row: the file is already gone.
                released++;
              } else if (cursor.getInt(1) == 1) {
                released++;
                movedToTrash++;
              } else {
                kept.add(entry);
              }
            } catch (Exception error) {
              kept.add(entry);
            }
          }
          deleteDocuments(token, documents, released, kept, movedToTrash);
        });
  }

  private void deleteDocuments(
      int token, List<Entry> entries, int releasedMedia, List<Entry> keptMedia, int movedToTrash) {
    if (entries.isEmpty()) {
      activity.runOnUiThread(() -> finishBatch(token, releasedMedia, 0, Collections.emptyList(), keptMedia, movedToTrash));
      return;
    }
    io.execute(
        () -> {
          int deleted = 0;
          List<Entry> failed = new ArrayList<>();
          try {
            SessionApi api = identity(token);
            MediaCatalog catalog = new MediaCatalog(activity);
            try (BackupJournal journal = new BackupJournal(activity)) {
              CleanupEngine engine = engine(journal, token);
              Set<String> existing = existingUris(api, entries, token);
              for (Entry entry : entries) {
                guard(token);
                try {
                  CleanupEngine.Candidate checked =
                      engine.local(scope, entry.mode, source(catalog, entry.item, token));
                  if (checked == null
                      || !checked.hash.equals(entry.hash)
                      || !writableDocument(entry.item)
                      || !existing.contains(entry.item.uri.toString())
                      || !DocumentsContract.deleteDocument(
                          activity.getContentResolver(), entry.item.uri)) {
                    failed.add(entry);
                    continue;
                  }
                  deleted++;
                } catch (Exception one) {
                  guard(token);
                  failed.add(entry);
                }
              }
            }
          } catch (Exception e) {
            fail(token, e);
            return;
          }
          int count = deleted;
          List<Entry> keep = failed;
          activity.runOnUiThread(() -> finishBatch(token, releasedMedia, count, keep, keptMedia, movedToTrash));
        });
  }

  private void finishBatch(
      int token,
      int releasedMedia,
      int releasedDocuments,
      List<Entry> failedDocuments,
      List<Entry> keptMedia,
      int movedToTrash) {
    if (token != generation || !isAttachedToWindow()) return;
    List<Entry> released = new ArrayList<>(session.pendingMedia);
    released.removeAll(keptMedia);
    List<Entry> releasedDocs = new ArrayList<>(session.pendingDocuments);
    releasedDocs.removeAll(failedDocuments);
    released.addAll(releasedDocs);
    plan.removeAll(released);
    // Keep items that could not be deleted this round; move them behind the rest so the
    // next batch still makes progress instead of retrying the same head forever.
    List<Entry> remainingFailures = new ArrayList<>();
    remainingFailures.addAll(keptMedia);
    remainingFailures.addAll(failedDocuments);
    plan.removeAll(remainingFailures);
    plan.addAll(remainingFailures);
    session.plan = new ArrayList<>(plan);
    session.clearPending();
    busy = false;
    cancel.setVisibility(GONE);
    int releasedCount = released.size();
    long releasedBytes = 0;
    for (Entry entry : released) releasedBytes += entry.item.size;
    if (releasedCount == 0) {
      status.setText("本批未删除文件");
      detail.setText("文件或备份状态可能已变化；已保留在计划中，请重试或重新检查。");
      action.setText(plan.isEmpty() ? "检查可释放空间" : "继续释放剩余 " + plan.size() + " 个");
      action.setEnabled(true);
      planConfirmed = !plan.isEmpty();
      return;
    }
    if (plan.isEmpty()) {
      reset(
          "清理完成，服务器备份已保留",
          "已释放 "
              + releasedCount
              + " 个文件，约 "
              + android.text.format.Formatter.formatShortFileSize(activity, releasedBytes)
              + "。");
      return;
    }
    status.setText(
        "本批已释放 "
            + releasedCount
            + " 个，约 "
            + android.text.format.Formatter.formatShortFileSize(activity, releasedBytes));
    detail.setText(
        "剩余 "
            + plan.size()
            + " 个，约 "
            + size(plan)
            + (failedDocuments.size() + keptMedia.size() > 0
                ? "；" + (failedDocuments.size() + keptMedia.size()) + " 个未删除或已变化，已保留在计划中"
                : "")
            + (movedToTrash > 0 ? "；" + movedToTrash + " 个在系统回收站，清空后释放空间" : "")
            + "。可继续释放下一批。");
    action.setText("继续释放剩余 " + plan.size() + " 个");
    action.setEnabled(true);
    planConfirmed = true;
  }

  private void finishAll() {
    if (plan.isEmpty()) reset("暂无可释放的空间");
    else {
      status.setText("可释放 " + size(plan));
      detail.setText(planDetail());
      action.setText("释放 " + size(plan));
      action.setEnabled(true);
    }
  }

  private void progress(int token, String text) {
    long now = System.currentTimeMillis();
    if (now - lastProgressAt < 300) return;
    lastProgressAt = now;
    activity.runOnUiThread(
        () -> {
          if (token == generation && isAttachedToWindow()) detail.setText(text);
        });
  }

  private int batchCount(List<Entry> entries) {
    int batches = 0, index = 0;
    while (index < entries.size()) {
      List<Entry> batch =
          CleanupPolicy.nextBatch(
              entries.subList(index, entries.size()),
              entry -> entry.item.size,
              MAX_BATCH_ITEMS,
              MAX_BATCH_BYTES);
      index += batch.size();
      batches++;
    }
    return batches;
  }

  private String size(List<Entry> entries) {
    long bytes = 0;
    for (Entry entry : entries) bytes += entry.item.size;
    return android.text.format.Formatter.formatShortFileSize(activity, bytes);
  }

  private void cancelWork() {
    generation++;
    busy = false;
    cancel.setVisibility(GONE);
    action.setEnabled(true);
    status.setText(plan.isEmpty() ? "已取消检查" : "已取消本次操作");
    detail.setText(plan.isEmpty() ? "可重新检查可释放空间。" : "清理计划已保留，可继续释放剩余 " + plan.size() + " 个。");
    action.setText(plan.isEmpty() ? "检查可释放空间" : "继续释放剩余 " + plan.size() + " 个");
    session.clearPending();
    planConfirmed = false;
  }

  private void reset(String message) {
    reset(message, "服务器备份已保留，可重新检查可释放空间。");
  }

  private void reset(String message, String detailText) {
    generation++;
    busy = false;
    plan = new ArrayList<>();
    session.clear();
    status.setText(message);
    detail.setText(detailText);
    action.setEnabled(true);
    action.setText("检查可释放空间");
    cancel.setVisibility(GONE);
    planConfirmed = false;
    syncingFilter = true;
    filter.setSelection(filterIndex(filterDays), false);
    syncingFilter = false;
  }

  private void fail(int token, Exception error) {
    android.util.Log.w("CleanupScreen", "清理检查失败", error);
    activity.runOnUiThread(
        () -> {
          if (token != generation || !isAttachedToWindow()) return;
          busy = false;
          cancel.setVisibility(GONE);
          action.setEnabled(true);
          status.setText("检查或释放未完成");
          detail.setText(
              error instanceof ApiClient.Failure
                  ? error.getMessage()
                  : "操作未完成，计划已保留。可重试或重新检查；服务器备份仍会保留。");
          action.setText(plan.isEmpty() ? "重新检查" : "继续释放剩余 " + plan.size() + " 个");
          session.clearPending();
          planConfirmed = false;
        });
  }

  @Override
  protected void onDetachedFromWindow() {
    generation++;
    busy = false;
    super.onDetachedFromWindow();
  }
}

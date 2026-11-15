package com.sekereagle.android;

import java.util.ArrayList;
import java.util.List;

/** Keeps one inspected cleanup plan alive across tab switches; never persisted to disk. */
final class CleanupSession {
  String scope = "";
  int filterDays;
  List<CleanupScreen.Entry> plan = new ArrayList<>();
  List<CleanupScreen.Entry> pendingBatch = new ArrayList<>();
  List<CleanupScreen.Entry> pendingMedia = new ArrayList<>();
  List<CleanupScreen.Entry> pendingDocuments = new ArrayList<>();

  void clear() {
    scope = "";
    filterDays = 0;
    plan = new ArrayList<>();
    clearPending();
  }

  void clearPending() {
    pendingBatch = new ArrayList<>();
    pendingMedia = new ArrayList<>();
    pendingDocuments = new ArrayList<>();
  }
}

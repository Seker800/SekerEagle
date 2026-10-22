package com.sekereagle.android;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

/** Native presentation tokens shared by the app bar, account and backup surfaces. */
final class Ui {
  static final int BG = 0xff09090b,
      SURFACE = 0xff1c1c20,
      LINE = 0xff323238,
      TEXT = 0xfff0f1f3,
      MUTED = 0xff9ca1ab,
      ACCENT = 0xff82aaff;

  static int dp(Context context, int value) {
    return (int) (value * context.getResources().getDisplayMetrics().density + .5f);
  }

  static TextView text(Context context, String value, int size) {
    TextView view = new TextView(context);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(TEXT);
    view.setLineSpacing(dp(context, 2), 1);
    view.setFontFeatureSettings("kern");
    if (size >= 18) view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    return view;
  }

  static TextView muted(Context context, String value, int size) {
    TextView view = text(context, value, size);
    view.setTextColor(MUTED);
    return view;
  }

  static MaterialButton button(Context context, String label, Runnable action) {
    MaterialButton view = new MaterialButton(context);
    view.setText(label);
    view.setAllCaps(false);
    view.setTextSize(14);
    view.setCornerRadius(dp(context, 24));
    view.setMinHeight(dp(context, 48));
    view.setInsetTop(0);
    view.setInsetBottom(0);
    view.setOnClickListener(v -> action.run());
    return view;
  }

  static MaterialButton secondary(Context context, String label, Runnable action) {
    MaterialButton view = button(context, label, action);
    view.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
    view.setTextColor(ACCENT);
    view.setStrokeWidth(dp(context, 1));
    view.setStrokeColor(ColorStateList.valueOf(LINE));
    return view;
  }

  static ImageButton iconButton(Context context, int icon, String label, Runnable action) {
    ImageButton view = new ImageButton(context);
    view.setImageResource(icon);
    view.setImageTintList(ColorStateList.valueOf(TEXT));
    view.setContentDescription(label);
    view.setPadding(dp(context, 12), dp(context, 12), dp(context, 12), dp(context, 12));
    android.util.TypedValue background = new android.util.TypedValue();
    context
        .getTheme()
        .resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, background, true);
    view.setBackgroundResource(background.resourceId);
    view.setOnClickListener(v -> action.run());
    view.setLayoutParams(new LinearLayout.LayoutParams(dp(context, 48), dp(context, 48)));
    return view;
  }

  static ImageView icon(Context context, int icon, int tint, int size) {
    ImageView view = new ImageView(context);
    view.setImageResource(icon);
    view.setImageTintList(ColorStateList.valueOf(tint));
    view.setLayoutParams(new LinearLayout.LayoutParams(dp(context, size), dp(context, size)));
    return view;
  }

  static LinearLayout panel(Context context) {
    LinearLayout view = new LinearLayout(context);
    view.setOrientation(LinearLayout.VERTICAL);
    int p = dp(context, 20);
    view.setPadding(p, p, p, p);
    return view;
  }

  static LinearLayout card(Context context, LinearLayout parent) {
    MaterialCardView card = new MaterialCardView(context);
    card.setRadius(dp(context, 20));
    card.setCardBackgroundColor(SURFACE);
    card.setStrokeColor(LINE);
    card.setStrokeWidth(dp(context, 1));
    card.setCardElevation(0);
    LinearLayout.LayoutParams spacing = new LinearLayout.LayoutParams(-1, -2);
    spacing.bottomMargin = dp(context, 14);
    parent.addView(card, spacing);
    LinearLayout content = panel(context);
    card.addView(content);
    return content;
  }

  static void space(LinearLayout parent, int height) {
    View view = new View(parent.getContext());
    parent.addView(view, new LinearLayout.LayoutParams(1, dp(parent.getContext(), height)));
  }

  static void section(LinearLayout parent, String title) {
    TextView view = muted(parent.getContext(), title, 12);
    view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    view.setPadding(
        dp(parent.getContext(), 4), dp(parent.getContext(), 12), 0, dp(parent.getContext(), 10));
    parent.addView(view);
  }

  static void divider(LinearLayout parent) {
    View line = new View(parent.getContext());
    line.setBackgroundColor(LINE);
    parent.addView(line, new LinearLayout.LayoutParams(-1, dp(parent.getContext(), 1)));
  }

  static LinearLayout row(
      Context context, int icon, String title, String subtitle, Runnable action) {
    LinearLayout row = new LinearLayout(context);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setMinimumHeight(dp(context, 64));
    row.setPadding(0, dp(context, 10), 0, dp(context, 10));
    ImageView image = icon(context, icon, MUTED, 22);
    LinearLayout.LayoutParams imageParams =
        new LinearLayout.LayoutParams(dp(context, 22), dp(context, 22));
    imageParams.rightMargin = dp(context, 14);
    row.addView(image, imageParams);
    LinearLayout labels = new LinearLayout(context);
    labels.setOrientation(LinearLayout.VERTICAL);
    labels.addView(text(context, title, 14));
    if (subtitle != null && !subtitle.isEmpty()) {
      TextView detail = muted(context, subtitle, 12);
      detail.setPadding(0, dp(context, 4), 0, 0);
      labels.addView(detail);
    }
    row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    if (action != null) {
      row.addView(icon(context, R.drawable.ic_chevron, MUTED, 18));
      row.setOnClickListener(v -> action.run());
      row.setFocusable(true);
      android.util.TypedValue background = new android.util.TypedValue();
      context
          .getTheme()
          .resolveAttribute(android.R.attr.selectableItemBackground, background, true);
      row.setBackgroundResource(background.resourceId);
    }
    return row;
  }
}

package com.sekereagle.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.widget.*;

final class Ui {
  static int dp(Context context, int value) {
    return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
  }

  static TextView text(Context context, String value, int size) {
    TextView view = new TextView(context);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(Color.rgb(224, 230, 239));
    view.setPadding(0, dp(context, 7), 0, dp(context, 7));
    if (size >= 20) view.setTypeface(null, Typeface.BOLD);
    return view;
  }

  static Button button(Context context, String label, Runnable action) {
    Button view = new Button(context);
    view.setText(label);
    view.setAllCaps(false);
    view.setOnClickListener(v -> action.run());
    return view;
  }

  static LinearLayout panel(Context context) {
    LinearLayout view = new LinearLayout(context);
    view.setOrientation(LinearLayout.VERTICAL);
    int padding = dp(context, 20);
    view.setPadding(padding, padding, padding, padding);
    return view;
  }
}

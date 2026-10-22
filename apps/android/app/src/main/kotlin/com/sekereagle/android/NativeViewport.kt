package com.sekereagle.android

/** Rotation must refit the image before applying the user's zoom, including portrait images. */
internal fun rotationFit(
    imageWidth: Int,
    imageHeight: Int,
    viewWidth: Int,
    viewHeight: Int,
    rotation: Float,
): Float {
    if (minOf(imageWidth, imageHeight, viewWidth, viewHeight) <= 0 || rotation % 180f == 0f)
        return 1f
    val original = minOf(viewWidth.toFloat() / imageWidth, viewHeight.toFloat() / imageHeight)
    val rotated = minOf(viewWidth.toFloat() / imageHeight, viewHeight.toFloat() / imageWidth)
    return rotated / original
}

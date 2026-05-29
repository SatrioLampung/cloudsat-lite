import io
import json
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image, ImageOps

from app.core.config import get_settings
from app.schemas import CloudPrediction, PixelBBox


IMAGE_HEIGHT = 384
IMAGE_WIDTH = 384
NUM_CHANNELS = 3
CLASS_NAMES = ["Fish", "Flower", "Sugar", "Gravel"]


@dataclass
class ModelState:
    model: object | None = None
    backend_name: str | None = None
    loaded: bool = False
    error: str | None = None


_STATE = ModelState()


def _lazy_import_tensorflow():
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers, regularizers

    return tf, keras, layers, regularizers


def get_custom_objects():
    tf, keras, layers, _ = _lazy_import_tensorflow()

    @tf.keras.utils.register_keras_serializable(package="Custom")
    class AsymmetricLoss(keras.losses.Loss):
        def __init__(
            self,
            gamma_neg=4.0,
            gamma_pos=1.0,
            clip=0.05,
            eps=1e-7,
            name="asymmetric_loss",
        ):
            super().__init__(name=name)
            self.gamma_neg = gamma_neg
            self.gamma_pos = gamma_pos
            self.clip = clip
            self.eps = eps

        def call(self, y_true, y_pred):
            y_true = tf.cast(y_true, tf.float32)
            y_pred = tf.clip_by_value(y_pred, self.eps, 1.0 - self.eps)

            xs_pos = y_pred
            xs_neg = 1.0 - y_pred

            if self.clip is not None and self.clip > 0:
                xs_neg = tf.clip_by_value(xs_neg + self.clip, 0.0, 1.0)

            loss_pos = y_true * tf.math.log(xs_pos)
            loss_neg = (1.0 - y_true) * tf.math.log(xs_neg)

            pt = xs_pos * y_true + xs_neg * (1.0 - y_true)
            gamma = self.gamma_pos * y_true + self.gamma_neg * (1.0 - y_true)
            weight = tf.pow(1.0 - pt, gamma)

            loss = -weight * (loss_pos + loss_neg)
            return tf.reduce_mean(tf.reduce_sum(loss, axis=-1))

        def get_config(self):
            config = super().get_config()
            config.update(
                {
                    "gamma_neg": self.gamma_neg,
                    "gamma_pos": self.gamma_pos,
                    "clip": self.clip,
                    "eps": self.eps,
                }
            )
            return config

    @tf.keras.utils.register_keras_serializable(package="Custom")
    class SpatialAveragePool(layers.Layer):
        def call(self, inputs):
            return tf.reduce_mean(inputs, axis=-1, keepdims=True)

        def get_config(self):
            return super().get_config()

    @tf.keras.utils.register_keras_serializable(package="Custom")
    class SpatialMaxPool(layers.Layer):
        def call(self, inputs):
            return tf.reduce_max(inputs, axis=-1, keepdims=True)

        def get_config(self):
            return super().get_config()

    return tf, keras, layers, AsymmetricLoss, SpatialAveragePool, SpatialMaxPool


def cbam_block(x, ratio=8, name="cbam"):
    _, _, layers, _, SpatialAveragePool, SpatialMaxPool = get_custom_objects()
    channel = int(x.shape[-1])
    hidden_units = max(channel // ratio, 1)

    avg_pool = layers.GlobalAveragePooling2D(name=f"{name}_gap")(x)
    max_pool = layers.GlobalMaxPooling2D(name=f"{name}_gmp")(x)

    shared_dense_1 = layers.Dense(
        hidden_units,
        activation="swish",
        kernel_initializer="he_normal",
        name=f"{name}_mlp_1",
    )
    shared_dense_2 = layers.Dense(
        channel,
        kernel_initializer="he_normal",
        name=f"{name}_mlp_2",
    )

    avg_out = shared_dense_2(shared_dense_1(avg_pool))
    max_out = shared_dense_2(shared_dense_1(max_pool))

    channel_attention = layers.Add(name=f"{name}_channel_add")([avg_out, max_out])
    channel_attention = layers.Activation("sigmoid", name=f"{name}_channel_sigmoid")(
        channel_attention
    )
    channel_attention = layers.Reshape((1, 1, channel), name=f"{name}_channel_reshape")(
        channel_attention
    )

    x = layers.Multiply(name=f"{name}_channel_multiply")([x, channel_attention])

    avg_pool_spatial = SpatialAveragePool(name=f"{name}_spatial_avg")(x)
    max_pool_spatial = SpatialMaxPool(name=f"{name}_spatial_max")(x)

    spatial = layers.Concatenate(axis=-1, name=f"{name}_spatial_concat")(
        [avg_pool_spatial, max_pool_spatial]
    )
    spatial_attention = layers.Conv2D(
        filters=1,
        kernel_size=7,
        padding="same",
        activation="sigmoid",
        kernel_initializer="he_normal",
        name=f"{name}_spatial_conv",
    )(spatial)

    x = layers.Multiply(name=f"{name}_spatial_multiply")([x, spatial_attention])
    return x


def build_cloud_attention_model(backbone_type="v2b1"):
    tf, keras, layers, regularizers = _lazy_import_tensorflow()
    get_custom_objects()

    keras.backend.clear_session()

    inputs = keras.Input(shape=(IMAGE_HEIGHT, IMAGE_WIDTH, NUM_CHANNELS), name="image")

    augmentation = keras.Sequential(
        [
            layers.RandomFlip("horizontal_and_vertical"),
            layers.RandomRotation(0.04),
            layers.RandomZoom(0.08),
            layers.RandomTranslation(0.05, 0.05),
            layers.RandomContrast(0.15),
        ],
        name="light_augmentation",
    )

    x = augmentation(inputs)

    if backbone_type == "v2b1":
        base_model = keras.applications.EfficientNetV2B1(
            include_top=False,
            weights=None,
            input_shape=(IMAGE_HEIGHT, IMAGE_WIDTH, NUM_CHANNELS),
            pooling=None,
            include_preprocessing=True,
        )
        backbone_name = "EfficientNetV2B1"
    elif backbone_type == "b3":
        base_model = keras.applications.EfficientNetB3(
            include_top=False,
            weights=None,
            input_shape=(IMAGE_HEIGHT, IMAGE_WIDTH, NUM_CHANNELS),
            pooling=None,
        )
        backbone_name = "EfficientNetB3"
    else:
        raise ValueError("backbone_type harus 'v2b1' atau 'b3'")

    x = base_model(x, training=False)
    x = cbam_block(x, ratio=8, name="cloud_cbam")

    gap = layers.GlobalAveragePooling2D(name="global_avg_pool")(x)
    gmp = layers.GlobalMaxPooling2D(name="global_max_pool")(x)

    x = layers.Concatenate(name="avg_max_concat")([gap, gmp])
    x = layers.BatchNormalization(name="head_bn_1")(x)

    x = layers.Dense(
        512,
        activation="swish",
        kernel_regularizer=regularizers.l2(1e-4),
        name="dense_512",
    )(x)
    x = layers.BatchNormalization(name="head_bn_2")(x)
    x = layers.Dropout(0.45, name="dropout_1")(x)

    x = layers.Dense(
        128,
        activation="swish",
        kernel_regularizer=regularizers.l2(1e-4),
        name="dense_128",
    )(x)
    x = layers.Dropout(0.25, name="dropout_2")(x)

    outputs = layers.Dense(
        len(CLASS_NAMES),
        activation="sigmoid",
        name="cloud_labels",
    )(x)

    return keras.Model(
        inputs=inputs,
        outputs=outputs,
        name=f"{backbone_name}_CBAM_cloud_classifier",
    )


def load_model(force_reload: bool = False) -> ModelState:
    settings = get_settings()

    if _STATE.loaded and not force_reload:
        return _STATE

    if not os.path.exists(settings.MODEL_WEIGHTS_PATH):
        _STATE.model = None
        _STATE.loaded = False
        _STATE.backend_name = None
        _STATE.error = f"Weights tidak ditemukan: {settings.MODEL_WEIGHTS_PATH}"
        return _STATE

    last_error: Exception | None = None

    for backbone in ("v2b1", "b3"):
        try:
            model = build_cloud_attention_model(backbone_type=backbone)
            model.load_weights(settings.MODEL_WEIGHTS_PATH)

            _STATE.model = model
            _STATE.loaded = True
            _STATE.backend_name = backbone
            _STATE.error = None
            return _STATE

        except Exception as exc:
            last_error = exc

    _STATE.model = None
    _STATE.loaded = False
    _STATE.backend_name = None
    _STATE.error = str(last_error)
    return _STATE


def crop_by_bbox(
    image_rgb: np.ndarray,
    bbox: Optional[PixelBBox],
) -> Tuple[np.ndarray, Optional[PixelBBox]]:
    if bbox is None:
        return image_rgb, None

    height, width = image_rgb.shape[:2]

    x1 = max(0, min(width - 1, int(bbox.x)))
    y1 = max(0, min(height - 1, int(bbox.y)))
    x2 = max(0, min(width, int(bbox.x + bbox.width)))
    y2 = max(0, min(height, int(bbox.y + bbox.height)))

    if x2 <= x1 or y2 <= y1:
        return image_rgb, None

    safe_bbox = PixelBBox(
        x=x1,
        y=y1,
        width=x2 - x1,
        height=y2 - y1,
    )

    return image_rgb[y1:y2, x1:x2], safe_bbox


def decode_image_bytes(file_bytes: bytes) -> np.ndarray:
    try:
        image = Image.open(io.BytesIO(file_bytes))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        return np.array(image)
    except Exception as exc:
        raise ValueError("Gambar gagal dibaca. Gunakan file PNG/JPG.") from exc


def resize_rgb_image(image_rgb: np.ndarray) -> np.ndarray:
    image = Image.fromarray(image_rgb.astype(np.uint8), mode="RGB")
    image = image.resize((IMAGE_WIDTH, IMAGE_HEIGHT), Image.Resampling.BILINEAR)
    return np.asarray(image).astype(np.float32)


def predict_image(
    file_bytes: bytes,
    bbox: Optional[PixelBBox] = None,
    threshold: Optional[float] = None,
) -> tuple[
    List[CloudPrediction],
    List[str],
    Optional[str],
    Optional[float],
    Optional[PixelBBox],
    str,
]:
    settings = get_settings()
    threshold_value = threshold if threshold is not None else settings.MODEL_THRESHOLD

    state = load_model()

    if not state.loaded or state.model is None:
        message = state.error or "Model belum dimuat."
        return [], [], None, None, None, message

    image_rgb = decode_image_bytes(file_bytes)
    image_rgb, bbox_used = crop_by_bbox(image_rgb, bbox)

    image_resized = resize_rgb_image(image_rgb)
    x = np.expand_dims(image_resized, axis=0)

    pred = state.model.predict(x, verbose=0)[0]

    predictions = [
        CloudPrediction(
            class_name=name,
            confidence=float(prob),
            detected=bool(prob >= threshold_value),
        )
        for name, prob in zip(CLASS_NAMES, pred)
    ]

    detected_labels = [item.class_name for item in predictions if item.detected]

    best_idx = int(np.argmax(pred))
    best_label = CLASS_NAMES[best_idx]
    best_confidence = float(pred[best_idx])

    return predictions, detected_labels, best_label, best_confidence, bbox_used, "OK"


def parse_bbox_json(bbox_text: str | None) -> Optional[PixelBBox]:
    if not bbox_text:
        return None

    data = json.loads(bbox_text)
    return PixelBBox(**data)

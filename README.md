# CloudSat Lite

Sistem ringan untuk:
- frontend React + CesiumJS
- layer peta dinamis NASA GIBS
- backend FastAPI Python
- klasifikasi awan dari bounding box / gambar
- data curah hujan open-source dari Open-Meteo
- refresh data time-dependent dari UI dan API

## Arsitektur tetap

```text
cloudsat-lite/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ schemas.py
│  │  ├─ core/
│  │  │  └─ config.py
│  │  └─ services/
│  │     ├─ gibs.py
│  │     ├─ rainfall.py
│  │     └─ cloud_model.py
│  ├─ models/
│  │  └─ .gitkeep
│  ├─ requirements.txt
│  └─ .env.example
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.js
│  ├─ .env.example
│  └─ src/
│     ├─ App.jsx
│     ├─ main.jsx
│     ├─ styles.css
│     ├─ api/
│     │  └─ client.js
│     └─ cesium/
│        └─ mapUtils.js
└─ README.md
```

## Cara jalankan

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
# source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Letakkan file weights model dari Kaggle/notebook ke:

```text
backend/models/cloud_attention_classifier_final.weights.h5
```

atau ubah `MODEL_WEIGHTS_PATH` di `backend/.env`.

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev -- --host 0.0.0.0
```

Buka:

```text
http://localhost:5173
```

## Alur kerja sistem

1. Frontend membuat globe Cesium.
2. Frontend meminta konfigurasi layer ke `/api/gibs/layers`.
3. Cesium mengambil layer NASA GIBS langsung dari endpoint WMS.
4. User memilih tanggal dan klik Refresh.
5. User menggambar bbox dua titik di peta.
6. Frontend capture canvas dan mengirim screenshot + pixel bbox ke `/api/cloud/classify`.
7. Backend memotong area bbox, resize 384x384, lalu menjalankan model TensorFlow sesuai notebook.
8. Frontend meminta data curah hujan ke `/api/rainfall/points`.
9. Backend mengambil data Open-Meteo dan menyimpan cache ringan.

## Catatan model AI

Notebook yang kamu kirim memakai:
- EfficientNetV2B1 atau EfficientNetB3
- CBAM block
- input 384 x 384 x 3
- kelas: Fish, Flower, Sugar, Gravel
- multi-label sigmoid
- threshold default 0.5

Backend dibuat kompatibel dengan struktur tersebut.

## Catatan NASA GIBS

Layer default disimpan di `backend/app/services/gibs.py`.
Kalau ada layer yang tidak muncul, ganti nama layer di file tersebut tanpa mengubah arsitektur folder.

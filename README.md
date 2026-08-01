# 🌟 Star Graphics Generator

Aplikasi Python interaktif untuk menghasilkan berbagai pola grafis menggunakan karakter bintang (★).

## 📋 Daftar Isi

- [Fitur](#fitur)
- [Instalasi](#instalasi)
- [Penggunaan](#penggunaan)
- [Pola Tersedia](#pola-tersedia)
- [File-file Proyek](#file-file-proyek)
- [Contoh Output](#contoh-output)

## ✨ Fitur

- **11+ Pola Grafis** - Pyramid, Diamond, Heart, Galaxy, dan masih banyak lagi
- **Mode Interaktif** - Menu pilihan untuk memilih pola yang diinginkan
- **Demo Otomatis** - Jalankan semua pola dengan animasi otomatis
- **Animasi Smooth** - Efek visual dengan delay yang dapat dikonfigurasi
- **Cross-Platform** - Kompatibel dengan Linux, macOS, dan Windows (dengan terminal Unicode)

## 🚀 Instalasi

Tidak ada dependensi eksternal yang diperlukan. Hanya butuh Python 3.6+.

```bash
# Clone atau download file ini
git clone <repository>
cd star-graphics

# Atau cukup download file .py
```

## 💻 Penggunaan

### Mode Interaktif

```bash
python3 hello.py
```

Akan menampilkan menu pilihan untuk memilih pola yang ingin ditampilkan.

```
  🌟 STAR GRAPHICS GENERATOR - INTERACTIVE MENU 🌟

   1. Pyramid
   2. Diamond
   3. Rectangle
   4. Wave
   5. Heart
   6. Spiral
   7. Galaxy
   8. Checkerboard
   9. Hourglass
  10. All Patterns
  11. Animated Wave

   0. Exit

  Select pattern (0-11): _
```

### Mode Demo Otomatis

```bash
python3 hello_demo.py
```

Menampilkan semua pola secara berurutan dengan animasi otomatis (~15 detik).

## 🎨 Pola Tersedia

| No. | Nama | Deskripsi |
|-----|------|-----------|
| 1 | **Pyramid** | Piramida bertingkat dengan bintang |
| 2 | **Diamond** | Bentuk berlian/intan |
| 3 | **Rectangle** | Persegi panjang dengan border bintang |
| 4 | **Wave** | Pola gelombang sinusoidal |
| 5 | **Heart** | Bentuk hati yang stylish |
| 6 | **Spiral** | Spiral yang mengisi grid |
| 7 | **Galaxy** | Pola konstelasi galaksi |
| 8 | **Checkerboard** | Papan catur dengan bintang |
| 9 | **Hourglass** | Bentuk jam pasir |
| 10 | **All Patterns** | Tampilkan semua pola sekaligus |
| 11 | **Animated Wave** | Gelombang animasi real-time |

## 📁 File-file Proyek

```
.
├── hello.py              # Mode interaktif dengan menu
├── hello_demo.py         # Mode demo otomatis
├── README.md             # Dokumentasi ini
├── CHANGELOG.md          # Riwayat perubahan
├── config.json           # Konfigurasi default
└── requirements.txt      # Dependensi (jika ada)
```

## ⚙️ Konfigurasi

Edit file `config.json` untuk mengubah pengaturan default:

```json
{
  "delay": 0.5,
  "pyramid_height": 6,
  "diamond_size": 5,
  "rectangle_width": 20,
  "rectangle_height": 6,
  "checkerboard_size": 8,
  "hourglass_size": 7,
  "animation_frames": 16
}
```

## 🎬 Contoh Output

### Pyramid
```
     ★
    ★★
   ★★★
  ★★★★
 ★★★★★
★★★★★★
```

### Diamond
```
    ★
   ★★★
  ★★★★★
 ★★★★★★★
★★★★★★★★★
 ★★★★★★★
  ★★★★★
   ★★★
    ★
```

### Heart
```
  ★★★       ★★★
 ★★★★★     ★★★★★
★★★★★★★   ★★★★★★★
★★★★★★★★ ★★★★★★★★
★★★★★★★★★★★★★★★★★
```

## 🎮 Shortcut Keyboard

- `0` - Exit
- `1-11` - Pilih pola
- `Ctrl+C` - Hentikan program

## 📝 Catatan Teknis

- Menggunakan karakter Unicode `★` (U+2605)
- Kompatibel dengan Python 3.6+
- Tidak memerlukan library eksternal
- Cross-platform (Windows/macOS/Linux)
- Terminal harus mendukung Unicode untuk tampilan optimal

## 🐛 Troubleshooting

### Output tidak menampilkan bintang dengan benar
- Pastikan terminal Anda mendukung Unicode
- Coba ubah encoding terminal ke UTF-8

### Program lambat atau delay tidak konsisten
- Ini normal pada sistem yang sibuk
- Ubah nilai `delay` di `config.json` jika diperlukan

## 📚 Extensibility

Mudah untuk menambahkan pola baru:

```python
def my_custom_pattern(self):
    """Pola custom saya"""
    print("\n⭐ MY CUSTOM PATTERN ⭐\n")
    # Tulis logika Anda di sini
    print("★" * 10)
```

## 📄 Lisensi

MIT License - Bebas digunakan untuk keperluan personal dan komersial

## 👨‍💻 Author

Dibuat dengan ❤️ menggunakan Python

## 📞 Support

Untuk pertanyaan atau saran, silakan buka issue di repository ini.

---

**Happy Star Generating!** ✨⭐✨

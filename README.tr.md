# Port Simulation

Saf HTML5 Canvas ve JavaScript ile geliştirilmiş, tarayıcı tabanlı 2D liman/konteyner sahası sürüş simülasyonu. Oyuncu, simüle edilmiş bir konteyner terminalinde bir araç kullanarak konteynerleri alır ve teslim eder; bunu yaparken vardiya süresi ve verimlilik puanlama sistemi altında güvenlik kurallarına (hız limiti, işçilerin yanında korna kullanımı) uymak zorundadır.

## Özellikler

- HTML5 Canvas üzerinde render edilen kuşbakışı 2D dünya (bölgeler, binalar, gemi, park halindeki kamyonlar, yayalar, trafik konileri, martılar)
- Görev sistemi: atanan konteyneri alıp teslimat bölgesine bırakma
- Güvenlik kuralı takibi: hız limitine uyum ve işçilerin yanında korna kullanımı, canlı ihlal sayacı ile
- Verimlilik puanı ve vardiya saati arayüz katmanı
- Mini harita (TOS tarzı) paneli
- Araç durum paneli (hız, yük, yakıt)
- Korna ve geri vites alarmı ses efektleri

## Teknoloji Yığını

- Sade HTML5, CSS3 ve JavaScript (framework yok, derleme adımı yok, dış bağımlılık yok)
- Tamamen tarayıcıda, Canvas 2D API üzerinden çalışır

## Proje Yapısı

```
index.html      Sayfa iskeleti ve arayüz katmanı işaretlemesi
style.css       Arayüz katmanı ve canvas düzeni stilleri
game.js         Oyun mantığı, render işlemleri ve simülasyon döngüsü
sources/        Görsel ve ses varlıkları (sprite'lar, ses efektleri)
```

## Başlarken

Herhangi bir derleme aracı veya paket yöneticisi gerekmez. Oyunu yerelde çalıştırmak için proje klasörünü herhangi bir statik dosya sunucusuyla servis edin (`index.html` dosyasını doğrudan `file://` ile açmak, bazı tarayıcılarda CORS kısıtlamaları nedeniyle varlık yüklemesini engelleyebilir).

Node.js kullanarak (kuruluysa):

```bash
npx serve .
```

Veya Python kullanarak:

```bash
python -m http.server 8000
```

Ardından tarayıcınızda yazdırılan yerel URL'yi açın (ör. `http://localhost:8000`).

## Kullanım / Kontroller

- `W` / `A` / `S` / `D` — aracı sürme
- Etkileşim tuşu (oyun içi panelde belirtilir) — konteyner alma / bırakma
- Korna tuşu — korna çalma (işçilerin yanında güvenlik uyumu için gereklidir)
- Boşluk tuşuna çift dokunuş — vardiyayı yeniden başlatma

Verimlilik puanınızı en üst düzeye çıkarmak için vardiya süresi dolmadan önce operasyon emrini (atanan konteyneri alıp teslim etme) temiz bir güvenlik kaydıyla tamamlayın.

## Bilinen Sorunlar

- `game.js` dosyası, depoda şu anda bulunmayan bir `background.png` arka plan görseline referans veriyor (yedek olarak `sources/background.png` de deneniyor). Arka plan görselinin düzgün yüklenmesi için eksik dosyanın eklenmesi veya referansın güncellenmesi gerekiyor.

## Lisans

Bu depoda şu anda bir lisans dosyası bulunmamaktadır. Bir lisans eklenmediği sürece tüm haklar yazara aittir. Bu projeyi paylaşmayı veya açık kaynak yapmayı düşünüyorsanız, başkalarının kodu hangi şartlarda kullanabileceğini, değiştirebileceğini ve dağıtabileceğini belirten bir `LICENSE` dosyası (ör. MIT, Apache-2.0) ekleyin.

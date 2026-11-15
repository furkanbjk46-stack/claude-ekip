# Claude Ekip: usta–işçi düzeni ve Ekip paneli

Claude Code için bir eklenti. Ana oturum bir **usta** gibi çalışır: işi anlar, zorluğunu tartar ve uygun **işçiye** devreder. Yan paneldeki **Ekip** kartları hangi modelin hangi işi yaptığını ve ne kadar token harcadığını canlı gösterir.

## İçindekiler

- **Dört işçi (alt ajan):**
  - `ekip-paneli:arama-iscisi` (Haiku): arama, okuma, özetleme
  - `ekip-paneli:uygulayici` (Sonnet): tarifi net kodlama işleri
  - `ekip-paneli:kidemli-usta` (Opus): orta zorlukta işler
  - `ekip-paneli:zor-is-uzmani` (Fable): büyük mimari kararlar ve en zor hatalar
- **Usta–işçi kuralları:** Ana oturumun sistem istemine eklenir. Usta önce işin zorluğunu değerlendirir, zor işi kendisi denemeden devreder. Mesajınıza "zor iş", "Opus yapsın" ya da "Fable yapsın" yazarsanız iş doğrudan o seviyeye gider.
- **Ekip paneli:** 5 saatlik kullanım penceresi, görevler ve zorlukları (Görevler başlığı açılır/kapanır), model başına token ve ekip kadrosu.
- **Komutlar:** `/ekip` paneli açar, `/ekip-sifirla` sayaçları sıfırlar.

## Kurulum

Bir terminal oturumunun istemine şunu yazın:

```
/plugin install ekip-paneli --marketplace furkanbjk46-stack/claude-ekip
```

`Add marketplace?` sorusuna `y` deyin, kapsam olarak kullanıcı kapsamını (user) seçin.

Kabuktan:

```bash
claude plugin install ekip-paneli --marketplace furkanbjk46-stack/claude-ekip
```

Masaüstü uygulamasında (`/plugin` çalışmıyorsa): istem kutusunun yanındaki **+** → **Plugins** → **Add marketplace** ile `furkanbjk46-stack/claude-ekip` ekleyin, sonra **Add plugin**.

## Önerilen ayar

Günlük işlerde ustanın Sonnet olması fiyat/performans açısından en iyisidir. `~/.claude/settings.json` dosyasına `"model": "sonnet"` ekleyin ya da model seçiciden Sonnet'i seçin. Zor işler Opus ve Fable işçilerine gider.

## Lisans

MIT

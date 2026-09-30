# AMF Dummy Mail

Webmail dummy untuk AMF GAMESTORE, siap di-deploy ke GitHub + Vercel.

## Login default
- Email: `admin@amfgamestore.my.id`
- Password: `Katasandi123`

## Cara kerja
- Login web memakai Basic Authorization di serverless API.
- Inbox membaca email dari Mail.tm REST API.
- Pengiriman email memakai SMTP Mail.tm (`smtp.mail.tm:587`).
- Kredensial mailbox Mail.tm disimpan sebagai Environment Variables Vercel, bukan di frontend.

## Environment Variables Vercel
Wajib:
- `MAILTM_EMAIL` = alamat mailbox Mail.tm yang dipakai
- `MAILTM_PASSWORD` = password mailbox Mail.tm

Opsional:
- `ADMIN_EMAIL` = default `admin@amfgamestore.my.id`
- `ADMIN_PASSWORD` = default `Katasandi123`
- `MAILTM_SMTP_HOST` = `smtp.mail.tm`
- `MAILTM_SMTP_PORT` = `587`
- `MAILTM_SMTP_SECURE` = `false`

## Deploy
1. Upload folder ini ke GitHub.
2. Import repository tersebut di Vercel.
3. Tambahkan Environment Variables.
4. Deploy.
5. Buka domain Vercel.

Catatan: alamat `admin@amfgamestore.my.id` adalah login aplikasi. Agar mailbox tersebut benar-benar menjadi mailbox Mail.tm, alamat/password mailbox Mail.tm harus dibuat/tersedia di Mail.tm dan dimasukkan ke `MAILTM_EMAIL` + `MAILTM_PASSWORD`. Login admin aplikasi dan akun mailbox Mail.tm adalah dua hal berbeda.

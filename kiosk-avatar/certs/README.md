# HTTPS cert pro kiosek (dev)

Vite servíruje kiosek přes HTTPS (nutné pro mikrofon — `getUserMedia` vyžaduje
zabezpečený kontext). Tenhle self-signed cert má **SAN** s `localhost`,
`127.0.0.1` a LAN IP — bez SAN s IP prohlížeče přístup přes IP adresu odmítnou.

## Když se změní IP počítače
Přegeneruj cert s novou IP (openssl je součástí Gitu):

```powershell
& "C:\Program Files\Git\usr\bin\openssl.exe" req -x509 -newkey rsa:2048 -nodes `
  -keyout key.pem -out cert.pem -days 825 `
  -subj "/CN=ReceptionAI Kiosk" `
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<NOVA_IP>"
```

Pak restartuj `npm run dev` v `kiosk/`.

## Odstranění varování v prohlížeči (volitelné)
Buď ve varování klikni *Pokročilé → Pokračovat*, nebo cert přidej mezi
důvěryhodné kořeny (vyžádá si potvrzení Windows):

```powershell
Import-Certificate -FilePath .\cert.pem -CertStoreLocation Cert:\CurrentUser\Root
```

`key.pem` je privátní klíč — nesdílet, nedávat do gitu.

<?php
// /vpn - Einstellungen. Nach config.php kopieren und anpassen.
// Nicht ueber das Web erreichbar (siehe .htaccess).

// Login-Passwort als Hash. Leer lassen: die Seite zeigt dann eine
// Einrichtungsansicht, die aus einem Passwort den Hash berechnet (nichts wird
// gespeichert). Den Hash hier eintragen.
const VPN_PASSWORD_HASH = '';

// MikroTik REST-API (RouterOS 7, /ip/service "www" oder "www-ssl").
// Der Benutzer braucht read + write auf /interface/wireguard.
const VPN_ROUTER    = 'http://192.168.88.1/rest';
const MIKROTIK_USER = 'vpn-web';
const MIKROTIK_PASS = 'change-me';

// WireGuard-Interface auf der MikroTik und sein Netz (z.B. 10.99.0.1/24).
const VPN_IFACE      = 'wg0';
const VPN_NETZ       = '10.99.0';
const VPN_RESERVIERT = [0, 1, 255];   // .1 = Router; weitere feste Adressen hier eintragen
const VPN_DNS        = '10.99.0.1';
const VPN_ENDPOINT   = 'vpn.example.com';   // Name oder IP, unter der der Router von aussen erreichbar ist
const VPN_ALLOWED    = '0.0.0.0/0, ::/0';   // alles durch den Tunnel; nur Heimnetz z.B. '10.99.0.0/24, 192.168.88.0/24'

// Kommentar-Praefix fuer Peers, die von dieser Seite stammen. Nur diese
// lassen sich hier auch wieder loeschen.
const VPN_MARKE = 'web: ';

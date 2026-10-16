import dns from 'node:dns/promises';
import net from 'node:net';

export async function validateAndSanitizeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Некорректный формат URL. Укажи полный адрес, например: https://my-project.onrender.com');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Разрешены только протоколы HTTP и HTTPS :)');
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Доступ к локальным адресам и внутренним сетям запрещен.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('Доступ к приватным IP-адресам запрещен.');
    }
  } else {
    try {
      const addresses = await dns.resolve4(hostname);
      for (const addr of addresses) {
        if (isPrivateIP(addr)) {
          throw new Error('Домен указывает на запрещенный приватный IP-адрес.');
        }
      }
    } catch {
      throw new Error('Не удалось разрешить доменное имя. Проверь правильность URL.');
    }
  }

  return parsed.toString();
}

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;

  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;

  return false;
}

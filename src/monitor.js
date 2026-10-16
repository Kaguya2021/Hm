export async function checkSite(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'RenderPingBot/1.0 (+https://github.com)' },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeoutId);

    const endTime = performance.now();
    const responseTime = Math.round(endTime - startTime);
    const isSuccess = response.status >= 200 && response.status < 400;

    return {
      success: isSuccess,
      status: isSuccess ? 'доступен' : 'ошибка',
      httpStatus: response.status,
      responseTime,
      error: isSuccess ? null : `HTTP статус ${response.status}`
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const endTime = performance.now();
    const responseTime = Math.round(endTime - startTime);

    let errorMsg = 'тайм-аут запроса';
    if (error.name !== 'AbortError') {
      errorMsg = error.message || 'ошибка сети';
    }

    return {
      success: false,
      status: 'ошибка',
      httpStatus: null,
      responseTime,
      error: errorMsg
    };
  }
}

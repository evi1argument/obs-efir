const $ = (id) => document.getElementById(id);
fetch('/api/pair').then((response) => {
  if (!response.ok) throw new Error();
  return response.json();
}).then(({ code, url, phone }) => {
  $('address').textContent = url;
  $('pair-code').textContent = code.match(/.{4}/g).join(' ');
  $('desktop').href = '/#' + code;
  $('desktop').hidden = false;
  $('copy').hidden = !phone;
  if (phone) {
    $('pair-qr').addEventListener('load', () => { $('pair-qr').hidden = false; });
    $('pair-qr').src = '/api/pair/qr';
  } else {
    $('wifi').textContent = 'Компьютер пока без адреса в локальной сети.';
  }
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url + '#' + code);
      $('pair-status').textContent = 'Ссылка скопирована.';
    } catch {
      $('pair-status').textContent = 'Открой адрес на телефоне и введи код вручную.';
    }
  });
}).catch(() => {
  $('pair-status').textContent = 'Код доступен на компьютере с OBS.';
});


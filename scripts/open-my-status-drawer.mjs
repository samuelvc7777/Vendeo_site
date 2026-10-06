const code = `
  // 1. Clica no item "Meu status" na lista para abrir a gaveta de status postados
  const divs = Array.from(document.querySelectorAll('span, div, p')).filter(e => e.innerText === 'Meu status');
  if (divs.length === 0) return { error: 'Meu status não encontrado' };
  
  const clickable = divs[0].closest('button, div[role="button"]') || divs[0];
  clickable.click();

  await new Promise(r => setTimeout(r, 1000));

  // 2. Inspeciona a gaveta lateral ou modal que abriu
  const drawer = document.querySelector('div[data-testid="status-drawer"], div[role="region"], div.x1n2onr6');
  
  const allTexts = Array.from(document.querySelectorAll('h1, h2, h3, span, p, div[role="button"]'))
    .map(e => e.innerText?.trim())
    .filter(t => t && t.length > 1 && t.length < 80)
    .slice(0, 40);

  const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).map(b => ({
    aria: b.getAttribute('aria-label'),
    dataIcon: b.querySelector('span[data-icon]')?.getAttribute('data-icon') || b.getAttribute('data-icon'),
    text: b.innerText?.trim()
  })).filter(b => b.aria || b.dataIcon || (b.text && /apagar|excluir|mais|menu/i.test(b.text)));

  return {
    allTexts,
    buttons: buttons.slice(0, 20)
  };
`;

const res = await fetch('http://127.0.0.1:8788/status/eval', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code })
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));

// Tira screenshot direto da gaveta que abriu
await new Promise(r => setTimeout(r, 500));
const snapRes = await fetch('http://127.0.0.1:8788/status/screenshot');
const snapData = await snapRes.json();
console.log(snapData.screenPath);

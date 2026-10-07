/* Shared: turns guide blocks from the database into the branded guide layout. */
window.GuideRender = (function(){
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function inline(s){
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[\[\+(.+?)\]\]/g, '<span class="tap go">$1</span>')
      .replace(/\[\[(.+?)\]\]/g, '<span class="tap">$1</span>')
      .replace(/\{\{(ok|bad|warn):(.+?)\}\}/g, '<span class="status $1">$2</span>');
  }
  function body(text){
    const out = []; let list = null;
    for (const raw of String(text||"").split("\n")){
      const line = raw.trimEnd();
      if (line.startsWith("- ")){ if (!list){ list = []; } list.push(`<li>${inline(line.slice(2))}</li>`); continue; }
      if (list){ out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (!line.trim()) continue;
      if (line.startsWith("> ")) out.push(`<p class="how">${inline(line.slice(2))}</p>`);
      else out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("");
  }
  function timeline(text){
    return `<ul class="tl">${String(text||"").split("\n").filter(l=>l.trim()).map(l=>{
      let key = false; if (l.startsWith("!")){ key = true; l = l.slice(1); }
      const [t, ...rest] = l.split("|");
      return `<li class="${key?"key":""}"><time>${esc(t.trim())}</time><span>${inline(rest.join("|").trim())}</span></li>`; }).join("")}</ul>`;
  }
  function render(blocks){
    const html = []; let i = 0;
    while (i < blocks.length){
      const b = blocks[i];
      if (b.kind === "step"){ const run = []; while (i < blocks.length && blocks[i].kind === "step") run.push(blocks[i++]);
        html.push(`<ol class="steps">${run.map(s=>`<li class="step"><div><h3>${esc(s.title)}</h3>${body(s.body)}</div></li>`).join("")}</ol>`); continue; }
      if (b.kind === "rule"){ const run = []; while (i < blocks.length && blocks[i].kind === "rule") run.push(blocks[i++]);
        html.push(`<div class="rules">${run.map(r=>`<div class="rule"><h3>${esc(r.title)}</h3>${body(r.body)}</div>`).join("")}</div>`); continue; }
      if (b.kind === "faq"){ const run = []; while (i < blocks.length && blocks[i].kind === "faq") run.push(blocks[i++]);
        html.push(`<div class="faqs">${run.map(f=>`<details><summary>${esc(f.title)}</summary>${body(f.body)}</details>`).join("")}</div>`); continue; }
      if (b.kind === "intro") html.push(`<div class="intro"><h2>${esc(b.title)}</h2>${body(b.body)}</div>`);
      else if (b.kind === "heading") html.push(`<h3 class="sub">${esc(b.title)}</h3>`);
      else if (b.kind === "text") html.push(`<div class="text">${b.title?`<h3>${esc(b.title)}</h3>`:""}${body(b.body)}</div>`);
      else if (b.kind === "timeline") html.push(`<div class="day"><h3>${esc(b.title)}</h3>${timeline(b.body)}</div>`);
      else if (b.kind.startsWith("note-")) html.push(`<div class="note ${b.kind.slice(5)}"><b>${esc(b.title)}</b>${body(b.body)}</div>`);
      i++;
    }
    return html.join("");
  }
  return { render, inline, body };
})();

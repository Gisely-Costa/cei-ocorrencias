// ===== Firebase init =====
if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
  alert("Configure o Firebase em firebase-config.js antes de usar.");
}
firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ===== Mapeamento de turmas por série =====
const TURMAS = {
  "1": ["M1","M2","M3","M4","M5"],
  "2": ["M1","M2","M3","M4"],
  "3": ["M1","M2","M3","M4","M5","M6"]
};

// ===== Estado simples =====
let cacheDisc = [];         // disciplinas (["Português", ...])
let cacheOcc = [];          // ocorrências (["Sem material", ...])
let cacheStudents = {};     // alunos { "1": { "M1": ["Ana", "João"] } }
let unsubRecords = null;    // unsubscribe da lista em tempo real
let lastRecords = [];       // cache para filtrar pesquisa

// ===== Seletores =====
const el = (s, root=document)=> root.querySelector(s);
const elAll = (s, root=document)=> Array.from(root.querySelectorAll(s));

// ===== Utilidades =====
const serverTS = () => firebase.firestore.FieldValue.serverTimestamp();
const fmt = (ts) => {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
};

// ===== Elementos =====
const loginSec = el("#login-section");
const mainSec  = el("#main-section");
const emailI   = el("#login-email");
const passI    = el("#login-password");
const loginErr = el("#login-error");
const userInfo = el("#userInfo");
const btnLogout= el("#btnLogout");

const serieSel = el("#serie");
const turmaSel = el("#turma");
const alunoSel = el("#aluno");
const discSel  = el("#disciplina");
const occWrap  = el("#ocorrencias");
const obsI     = el("#observacao");
const listaDiv = el("#lista");
const buscaI   = el("#pesquisa");

const btnLogin   = el("#btnLogin");
const btnRegister= el("#btnRegister");
const btnReset   = el("#btnReset");
const btnSalvar  = el("#btnSalvar");
const btnLimpar  = el("#btnLimpar");

const btnGerAlunos = el("#btnGerenciarAlunos");
const btnGerDisc   = el("#btnGerenciarDisc");
const btnGerOcc    = el("#btnGerenciarOcc");

// ===== Listeners UI =====
document.addEventListener("DOMContentLoaded", () => {
  // auth events
  btnLogin.addEventListener("click", login);
  btnRegister.addEventListener("click", register);
  btnReset.addEventListener("click", resetPwd);
  btnLogout.addEventListener("click", () => auth.signOut());

  // selects
  serieSel.addEventListener("change", onSerieChange);
  turmaSel.addEventListener("change", onTurmaChange);

  // form
  btnSalvar.addEventListener("click", salvarOcorrencia);
  btnLimpar.addEventListener("click", limparForm);
  buscaI.addEventListener("input", () => renderLista());

  // gerenciar
  btnGerAlunos.addEventListener("click", gerenciarAlunos);
  btnGerDisc.addEventListener("click", gerenciarDisciplinas);
  btnGerOcc.addEventListener("click", gerenciarOcorrencias);

  // auth state
  auth.onAuthStateChanged(async (user) => {
    userInfo.textContent = user ? (user.email || "Usuário") : "";
    btnLogout.style.display = user ? "" : "none";
    loginSec.classList.toggle("hidden", !!user);
    mainSec.classList.toggle("hidden", !user);

    if (user) {
      await carregarConfiguracoes();
      preencherDisciplinas();
      preencherOcorrencias();
      onSerieChange(); // para preparar turma/aluno
      assinarRegistros();
    } else {
      if (unsubRecords) { unsubRecords(); unsubRecords = null; }
      listaDiv.innerHTML = "";
    }
  });
});

// ===== Autenticação =====
async function login() {
  loginErr.textContent = "";
  try {
    await auth.signInWithEmailAndPassword(emailI.value.trim(), passI.value);
  } catch (e) {
    loginErr.textContent = e.message;
  }
}
async function register() {
  loginErr.textContent = "";
  try {
    await auth.createUserWithEmailAndPassword(emailI.value.trim(), passI.value);
  } catch (e) {
    loginErr.textContent = e.message;
  }
}
async function resetPwd() {
  const email = emailI.value.trim();
  if (!email) { loginErr.textContent = "Digite seu e-mail para receber o link."; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    alert("E-mail de redefinição enviado.");
  } catch (e) {
    loginErr.textContent = e.message;
  }
}

// ===== Configurações (coleções 'config/*' no Firestore) =====
// Estrutura:
//  config/disciplines { list: ["Português", ...] }
//  config/occurrences { list: ["Sem material", ...] }
//  config/students    { data: { "1": { "M1": ["Ana","João"], ... }, ... } }

async function carregarConfiguracoes() {
  const [disc, occ, studs] = await Promise.all([
    db.collection("config").doc("disciplines").get(),
    db.collection("config").doc("occurrences").get(),
    db.collection("config").doc("students").get()
  ]);

  cacheDisc = disc.exists ? (disc.data().list || []) :
    ["Português","Matemática","História","Geografia"];
  cacheOcc = occ.exists ? (occ.data().list || []) : [
    "Não cumpriu tarefa",
    "Sem material",
    "Uso de celular em sala",
    "Uso de fone em sala",
    "Chegou atrasado",
    "Desrespeitou o professor"
  ];
  cacheStudents = studs.exists ? (studs.data().data || {}) : {};
}

function preencherDisciplinas() {
  discSel.innerHTML = "";
  cacheDisc.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    discSel.appendChild(opt);
  });
}

function preencherOcorrencias() {
  occWrap.innerHTML = "";
  cacheOcc.forEach(o => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${o}"> ${o}`;
    occWrap.appendChild(label);
  });
}

// ===== Série/Turma/Aluno =====
function onSerieChange() {
  const s = serieSel.value;
  turmaSel.innerHTML = "";
  alunoSel.innerHTML = "";

  if (!s || !TURMAS[s]) { return; }
  TURMAS[s].forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = `${s}ª ${t}`;
    turmaSel.appendChild(opt);
  });

  onTurmaChange();
}

function onTurmaChange() {
  const s = serieSel.value;
  const t = turmaSel.value;
  alunoSel.innerHTML = "";
  const list = (cacheStudents?.[s]?.[t]) || [];
  if (list.length === 0) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "Cadastre alunos (Gerenciar Alunos)";
    alunoSel.appendChild(opt);
    alunoSel.disabled = true;
  } else {
    alunoSel.disabled = false;
    const first = document.createElement("option");
    first.value = ""; first.textContent = "Selecione o aluno...";
    alunoSel.appendChild(first);
    list.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n; opt.textContent = n;
      alunoSel.appendChild(opt);
    });
  }
}

// ===== Gerenciar (via prompt simples) =====
async function gerenciarAlunos() {
  const s = serieSel.value; const t = turmaSel.value;
  if (!s || !t) { alert("Selecione primeiro a série e a turma."); return; }

  const lista = (cacheStudents?.[s]?.[t]) || [];
  const texto = prompt(
    `Edite os alunos da ${s}ª ${t}.\nUm nome por linha:`,
    lista.join("\n")
  );
  if (texto == null) return; // cancelado

  const nomes = texto.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  if (!cacheStudents[s]) cacheStudents[s] = {};
  cacheStudents[s][t] = nomes;

  await db.collection("config").doc("students").set({ data: cacheStudents }, { merge: true });
  onTurmaChange();
  alert("Alunos salvos.");
}

async function gerenciarDisciplinas() {
  const texto = prompt(
    "Edite as disciplinas (uma por linha):",
    cacheDisc.join("\n")
  );
  if (texto == null) return;
  cacheDisc = texto.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  await db.collection("config").doc("disciplines").set({ list: cacheDisc }, { merge: true });
  preencherDisciplinas();
  alert("Disciplinas salvas.");
}

async function gerenciarOcorrencias() {
  const texto = prompt(
    "Edite as ocorrências (uma por linha):",
    cacheOcc.join("\n")
  );
  if (texto == null) return;
  cacheOcc = texto.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  await db.collection("config").doc("occurrences").set({ list: cacheOcc }, { merge: true });
  preencherOcorrencias();
  alert("Ocorrências salvas.");
}

// ===== Salvar / Limpar =====
async function salvarOcorrencia() {
  const serie = serieSel.value;
  const turma = turmaSel.value;
  const aluno = alunoSel.value;
  const disciplina = discSel.value;
  const obs = (obsI.value || "").trim();
  const ocorrencias = elAll('#ocorrencias input[type="checkbox"]:checked').map(i=>i.value);

  if (!serie || !turma) { alert("Selecione a série e a turma."); return; }
  if (!aluno) { alert("Selecione o aluno."); return; }
  if (ocorrencias.length === 0 && !obs) { alert("Marque ao menos uma ocorrência ou escreva uma observação."); return; }

  const rec = {
    serie, turma, aluno, disciplina, ocorrencias, obs,
    createdAt: serverTS(),
    createdBy: auth.currentUser?.uid || null,
    createdByEmail: auth.currentUser?.email || null
  };
  await db.collection("records").add(rec);
  limparForm();
  alert("Registro salvo!");
}

function limparForm() {
  serieSel.value = "";
  turmaSel.innerHTML = "";
  alunoSel.innerHTML = "";
  discSel.selectedIndex = 0;
  obsI.value = "";
  elAll('#ocorrencias input[type="checkbox"]').forEach(c => c.checked = false);
  buscaI.value = "";
}

// ===== Listagem em tempo real + pesquisa + exclusão =====
function assinarRegistros() {
  if (unsubRecords) { unsubRecords(); unsubRecords = null; }
  unsubRecords = db.collection("records")
    .orderBy("createdAt","desc")
    .limit(1000)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(doc => arr.push({ id: doc.id, ...doc.data() }));
      lastRecords = arr;
      renderLista();
    }, err => {
      console.error(err);
      alert("Erro ao carregar registros. Verifique regras do Firestore.");
    });
}

function renderLista() {
  const termo = (buscaI.value || "").toLowerCase().trim();
  listaDiv.innerHTML = "";

  let count = 0;
  for (const r of lastRecords) {
    if (termo && !r.aluno?.toLowerCase().includes(termo)) continue;

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <h3 style="margin:0 0 6px;">${r.aluno}</h3>
      <div class="meta">${r.serie}ª ${r.turma} · ${r.disciplina || "-"} · ${r.createdAt ? fmt(r.createdAt) : ""} ${r.createdByEmail ? " · por " + r.createdByEmail : ""}</div>
      <div class="tags">${(r.ocorrencias||[]).map(o=>`<span class="tag">${o}</span>`).join(" ") || "<span class='muted'>Sem marcações</span>"}</div>
      ${r.obs ? `<div><strong>Obs.:</strong> ${escapeHtml(r.obs)}</div>` : ""}
      <div class="row" style="margin-top:8px;">
        <button class="btn small ghost" data-del="${r.id}">Excluir</button>
      </div>
    `;
    div.querySelector("[data-del]").addEventListener("click", async () => {
      if (confirm("Excluir este registro?")) {
        await db.collection("records").doc(r.id).delete();
      }
    });
    listaDiv.appendChild(div);
    count++;
  }

  if (count === 0) {
    listaDiv.innerHTML = "<p class='muted'>Nenhum registro encontrado.</p>";
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m)=>({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m]));
}

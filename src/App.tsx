import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onValue, set } from "firebase/database";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { dataRef } from "./firebase";
import logoTurmaFacil from "./assets/turma-facil-brasil-logo.svg";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ── Types ──────────────────────────────────────────────────────────────
type Screen =
  | "login" | "cadastro" | "home" | "turmas" | "turma-detail"
  | "criar-turma" | "chamada" | "historico-chamadas" | "lancamento-notas"
  | "escolas" | "perfil";

type Turno = "Manhã" | "Tarde" | "Noite";
type Presenca = "P" | "F" | "FJ";

interface Aluno { id: number; nome: string; matricula: string; }
interface Turma {
  id: number; nome: string; escola: string; turno: Turno;
  serie: string; disciplina: string; anoLetivo: number;
  bimestre: number; alunos: Aluno[];
}
interface Escola {
  id: number; nome: string; cidade: string;
  estado: string; rede: "Estadual" | "Municipal" | "Privada";
}
interface Chamada { id: number; turmaId: number; data: string; presencas: Record<number, Presenca>; }
interface NotaAluno { [key: string]: string; ac: string; ae: string; prova: string; outros: string; rec: string; }
interface NotaComponente { id: string; nome: string; peso: number; }
interface ComposicaoNota { itens: NotaComponente[]; }

const hoje = new Date().toISOString().split("T")[0];

// ── Utils ─────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function calcMedia(n: NotaAluno): string {
  const vals = [n.ac, n.ae, n.prova, n.outros].map((v) => parseFloat(v)).filter((v) => !isNaN(v));
  if (!vals.length) return "";
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}
function initNotas(alunos: Aluno[]): Record<number, NotaAluno> {
  const r: Record<number, NotaAluno> = {};
  alunos.forEach((a) => { r[a.id] = { ac: "", ae: "", prova: "", outros: "", rec: "" }; });
  return r;
}
function frequenciaAluno(alunoId: number, chamadas: Chamada[]) {
  const total = chamadas.length;
  const faltas = chamadas.filter((c) => c.presencas[alunoId] === "F" || c.presencas[alunoId] === "FJ").length;
  return { total, faltas, percentual: total ? ((total - faltas) / total) * 100 : 100 };
}
function calcMediaPonderada(n: NotaAluno, composicao: ComposicaoNota): string {
  const validos = composicao.itens.filter((item) => n[item.id]?.trim() !== "" && !isNaN(parseFloat(n[item.id])));
  if (!validos.length) return "";
  const pesoTotal = validos.reduce((sum, item) => sum + item.peso, 0);
  if (!pesoTotal) return "";
  const media = validos.reduce((sum, item) => sum + parseFloat(n[item.id]) * item.peso, 0) / pesoTotal;
  return media.toFixed(1);
}
function normalizeComposicao(value?: ComposicaoNota | Record<string, number>): ComposicaoNota {
  if (value && "itens" in value && Array.isArray(value.itens)) return value;
  const legacy = value || {};
  return { itens: [
    { id: "ac", nome: "Trabalhos", peso: legacy.ac ?? 25 },
    { id: "ae", nome: "Atividades", peso: legacy.ae ?? 25 },
    { id: "prova", nome: "Provas", peso: legacy.prova ?? 40 },
    { id: "outros", nome: "Outros", peso: legacy.outros ?? 10 },
  ] };
}

async function extractStudentNames(file: File): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const names: string[] = [];
  const seen = new Set<string>();
  let collecting = false;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => ("str" in item ? item.str : "").trim().replace(/\s+/g, " "))
      .filter(Boolean);

    for (const line of lines) {
      const normalized = line.toLocaleUpperCase("pt-BR");
      if (normalized === "ALUNO") {
        collecting = true;
        continue;
      }
      if (collecting && normalized.startsWith("OBSERVA")) {
        collecting = false;
        break;
      }
      if (!collecting || !/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇÜ' -]+$/i.test(line)) continue;

      const words = line.split(" ").filter(Boolean);
      if (words.length < 2 || line !== normalized) continue;

      const key = normalized.replace(/\s+/g, " ");
      if (!seen.has(key)) {
        seen.add(key);
        names.push(line);
      }
    }
  }

  return names;
}

function exportChamadaExcel(turma: Turma, chamada: Chamada) {
  const escapeCell = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = turma.alunos.map((aluno, index) => `
    <tr><td>${index + 1}</td><td>${escapeCell(aluno.nome)}</td><td>${chamada.presencas[aluno.id] || "P"}</td></tr>`).join("");
  const html = `
    <table>
      <tr><th colspan="3">Relatório de chamada</th></tr>
      <tr><td>Dia</td><td colspan="2">${fmtDate(chamada.data)}</td></tr>
      <tr><td>Turma</td><td colspan="2">${escapeCell(turma.nome)}</td></tr>
      <tr><td>Escola</td><td colspan="2">${escapeCell(turma.escola)}</td></tr>
      <tr><th>Número</th><th>Aluno</th><th>Presença</th></tr>
      ${rows}
    </table>`;
  const blob = new Blob([`\ufeff<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chamada-${turma.nome}-${chamada.data}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportChamadaPdf(turma: Turma, chamada: Chamada) {
  const document = new jsPDF();
  document.setFontSize(16);
  document.text("Relatório de chamada", 14, 18);
  document.setFontSize(10);
  document.text(`Dia: ${fmtDate(chamada.data)}`, 14, 28);
  document.text(`Turma: ${turma.nome}`, 14, 35);
  document.text(`Escola: ${turma.escola}`, 14, 42);
  autoTable(document, {
    startY: 50,
    head: [["#", "Aluno", "Presença"]],
    body: turma.alunos.map((aluno, index) => [
      String(index + 1), aluno.nome, chamada.presencas[aluno.id] || "P",
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [26, 111, 224] },
  });
  document.save(`chamada-${turma.nome}-${chamada.data}.pdf`);
}

// ── SVG Icons ─────────────────────────────────────────────────────────
const IcoHome = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>;
const IcoGroup = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>;
const IcoCheck = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>;
const IcoSchool = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg>;
const IcoUser = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>;
const IcoPlus = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>;
const IcoBack = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>;
const IcoCalendar = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>;
const IcoEdit = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>;
const IcoUpload = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>;
const IcoClose = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;
const IcoChevron = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>;
const IcoLogout = ({ cls = "" }) => <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>;

// ── Sidebar Nav (desktop) ─────────────────────────────────────────────
const NAV_ITEMS = [
  { screen: "home" as Screen, label: "Início", Icon: IcoHome },
  { screen: "turmas" as Screen, label: "Turmas", Icon: IcoGroup },
  { screen: "escolas" as Screen, label: "Escolas", Icon: IcoSchool },
  { screen: "perfil" as Screen, label: "Perfil", Icon: IcoUser },
];

function Sidebar({ active, go }: { active: Screen; go: (s: Screen) => void }) {
  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full w-56 bg-white border-r border-[#E1E8F5] z-50 shadow-sm">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#E1E8F5]">
        <img src={logoTurmaFacil} alt="Turma Fácil Brasil" className="w-full h-12 object-contain object-left" />
      </div>
      {/* Nav items */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ screen, label, Icon }) => {
          const isActive = active === screen;
          return (
            <button key={screen} onClick={() => go(screen)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-600 transition-all text-left w-full"
              style={{
                fontFamily: "Outfit",
                background: isActive ? "#EBF2FF" : "transparent",
                color: isActive ? "#1A6FE0" : "#6B7A9A",
              }}>
              <Icon cls={`w-5 h-5 ${isActive ? "opacity-100" : "opacity-70"}`} />
              {label}
            </button>
          );
        })}
      </nav>
      {/* User footer */}
      <div className="px-4 py-4 border-t border-[#E1E8F5]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-700"
            style={{ background: "linear-gradient(135deg,#1A6FE0,#13A768)", fontFamily: "Outfit" }}>A</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-600 text-[#1A2340] truncate">Meu perfil</p>
            <p className="text-[10px] text-[#6B7A9A] truncate">Dados do usuário</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Bottom Nav (mobile) ───────────────────────────────────────────────
function BottomNav({ active, go }: { active: Screen; go: (s: Screen) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E1E8F5] z-50">
      <div className="flex">
        {NAV_ITEMS.map(({ screen, label, Icon }) => {
          const isActive = active === screen;
          return (
            <button key={screen} onClick={() => go(screen)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors"
              style={{ color: isActive ? "#1A6FE0" : "#6B7A9A" }}>
              <Icon cls={`w-6 h-6 ${isActive ? "opacity-100" : "opacity-60"}`} />
              <span className="text-[10px] font-600" style={{ fontFamily: "Outfit" }}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Page Shell ────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:ml-56 min-h-screen w-full overflow-x-hidden">
      {children}
    </div>
  );
}

function RouteFallback({ go }: { go: (screen: Screen) => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-700 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>Turma não encontrada</h1>
      <p className="text-sm text-[#6B7A9A] mt-1 mb-4">Selecione uma turma para continuar.</p>
      <button onClick={() => go("turmas")} className="px-4 py-2.5 rounded-xl text-sm font-700 text-white" style={{ background: "#1A6FE0", fontFamily: "Outfit" }}>
        Voltar para turmas
      </button>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────
function Header({ title, subtitle, onBack, action }: {
  title: string; subtitle?: string; onBack?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <header className="bg-white border-b border-[#E1E8F5] px-4 md:px-6 py-3.5 flex items-center gap-3 sticky top-0 z-40">
      {onBack && (
        <button onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F4F7FE] transition-colors flex-shrink-0">
          <IcoBack cls="w-5 h-5 text-[#1A2340]" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-700 text-[#1A2340] leading-tight" style={{ fontFamily: "Outfit" }}>{title}</h1>
        {subtitle && <p className="text-xs text-[#6B7A9A]">{subtitle}</p>}
      </div>
      {action && (
        <button onClick={action.onClick}
          className="text-sm font-600 text-[#1A6FE0] px-3 py-1.5 rounded-lg hover:bg-[#EBF2FF] transition-colors flex-shrink-0"
          style={{ fontFamily: "Outfit" }}>{action.label}</button>
      )}
    </header>
  );
}

// ── Shared components ─────────────────────────────────────────────────
function Field({ label, children, error, cls = "" }: {
  label?: string; children: React.ReactNode; error?: string; cls?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${cls}`}>
      {label && <label className="text-sm font-600 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>{label}</label>}
      {children}
      {error && <p className="text-xs text-[#E63946]">{error}</p>}
    </div>
  );
}
function fieldCls(err: boolean) {
  return `w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors bg-white ${err ? "border-[#E63946] bg-[#FFF5F5]" : "border-[#E1E8F5] focus:border-[#1A6FE0]"}`;
}
function Btn({ children, onClick, primary, loading, cls = "" }: {
  children: React.ReactNode; onClick?: () => void; primary?: boolean; loading?: boolean; cls?: string;
}) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`py-3 px-6 rounded-xl text-sm font-700 flex items-center justify-center gap-2 transition-all active:scale-[0.98] w-full ${cls} ${primary ? "text-white" : "border border-[#E1E8F5] text-[#1A2340] bg-white hover:bg-[#F4F7FE]"}`}
      style={{ fontFamily: "Outfit", background: primary ? (loading ? "#7AA8E8" : "#1A6FE0") : undefined }}>
      {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : children}
    </button>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ background: on ? "#1A6FE0" : "#E1E8F5" }}>
      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
        style={{ left: on ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );
}

// ── Turma Card ────────────────────────────────────────────────────────
function TurmaCard({ turma, onOpen, onChamada, onNotas }: {
  turma: Turma; onOpen: () => void; onChamada: () => void; onNotas: () => void;
}) {
  const turnoBg: Record<Turno, string> = { "Manhã": "#EBF2FF", "Tarde": "#FEF3E2", "Noite": "#EDE9FE" };
  const turnoColor: Record<Turno, string> = { "Manhã": "#1A6FE0", "Tarde": "#F4A11A", "Noite": "#7C3AED" };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E1E8F5] overflow-hidden hover:shadow-md hover:border-[#C5D5F0] transition-all">
      <button className="w-full text-left p-4" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-700 text-[#1A2340] text-sm leading-tight truncate" style={{ fontFamily: "Outfit" }}>{turma.nome}</h4>
            <p className="text-xs text-[#6B7A9A] mt-0.5 truncate">{turma.escola} · {turma.serie}</p>
            <p className="text-xs text-[#6B7A9A] truncate">{turma.disciplina}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-xs px-2 py-0.5 rounded-full font-600"
              style={{ background: turnoBg[turma.turno], color: turnoColor[turma.turno] }}>{turma.turno}</span>
            <span className="text-xs text-[#6B7A9A]">{turma.alunos.length} alunos</span>
          </div>
        </div>
      </button>
      <div className="flex border-t border-[#E1E8F5]">
        <button onClick={onChamada}
          className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-xs font-600 text-[#1A6FE0] hover:bg-[#EBF2FF] transition-colors"
          style={{ fontFamily: "Outfit" }}>
          <IcoCheck cls="w-4 h-4" /> Chamada
        </button>
        <div className="w-px bg-[#E1E8F5]" />
        <button onClick={onNotas}
          className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-xs font-600 text-[#13A768] hover:bg-[#E6F9F1] transition-colors"
          style={{ fontFamily: "Outfit" }}>
          <IcoEdit cls="w-4 h-4" /> Notas
        </button>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────
function LoginScreen({ go }: { go: (s: Screen) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!email) e.email = "E-mail obrigatório";
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = "E-mail inválido";
    if (!senha) e.senha = "Senha obrigatória";
    else if (senha.length < 6) e.senha = "Mínimo 6 caracteres";
    return e;
  }
  function handleLogin() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setLoading(true);
    setTimeout(() => { setLoading(false); go("home"); }, 900);
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Left panel — visible on desktop */}
      <div className="hidden md:flex md:w-1/2 lg:w-2/5 flex-col items-center justify-center p-12"
        style={{ background: "linear-gradient(160deg,#1A6FE0 0%,#0E4FAA 50%,#13A768 100%)" }}>
        <img src={logoTurmaFacil} alt="Turma Fácil Brasil" className="w-64 h-64 object-contain mb-3" />
        <p className="text-white/75 text-lg text-center max-w-xs leading-relaxed">
          Gestão digital de turmas, chamadas e notas para professores
        </p>
        <div className="mt-12 grid grid-cols-1 gap-4 w-full max-w-xs">
          {["Chamada rápida com poucos toques","Lançamento de notas em tabela","Importação automática de alunos"].map((f) => (
            <div key={f} className="flex items-center gap-3 bg-white/10 rounded-xl px-4 py-3">
              <IcoCheck cls="w-5 h-5 text-white/80 flex-shrink-0" />
              <span className="text-white/90 text-sm">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col">
        {/* Mobile gradient top */}
        <div className="md:hidden px-6 pt-14 pb-8"
          style={{ background: "linear-gradient(160deg,#1A6FE0,#13A768)" }}>
          <img src={logoTurmaFacil} alt="Turma Fácil Brasil" className="w-56 h-28 object-contain object-left" />
        </div>

        <div className="flex-1 bg-white md:flex md:items-center md:justify-center rounded-t-3xl md:rounded-none -mt-3 md:mt-0 px-6 py-8 md:px-16 lg:px-24">
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-700 text-[#1A2340] mb-6" style={{ fontFamily: "Outfit" }}>Entrar na conta</h2>
            <div className="flex flex-col gap-4 mb-2">
              <Field label="E-mail" error={errors.email}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com" className={fieldCls(!!errors.email)} />
              </Field>
              <Field label="Senha" error={errors.senha}>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••" className={fieldCls(!!errors.senha)} />
              </Field>
            </div>
            <button className="text-sm text-[#1A6FE0] font-500 self-end block ml-auto mb-5">Esqueci minha senha</button>
            <Btn onClick={handleLogin} loading={loading} primary>Entrar</Btn>
            <p className="text-center text-sm text-[#6B7A9A] mt-5">
              Não tem conta?{" "}
              <button onClick={() => go("cadastro")} className="text-[#1A6FE0] font-600">Criar conta</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CADASTRO ──────────────────────────────────────────────────────────
function CadastroScreen({ go }: { go: (s: Screen) => void }) {
  const disciplinas = ["Biologia","Matemática","Português","História","Geografia","Física","Química","Informática","Zootecnia","Agronegócio","Ed. Física"];
  const [sel, setSel] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  function toggle(d: string) { setSel((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d]); }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="hidden md:flex md:w-1/2 lg:w-2/5 flex-col items-center justify-center p-12"
        style={{ background: "linear-gradient(160deg,#1A6FE0 0%,#0E4FAA 50%,#13A768 100%)" }}>
        <img src={logoTurmaFacil} alt="Turma Fácil Brasil" className="w-64 h-64 object-contain mb-3" />
        <p className="text-white/75 text-lg text-center max-w-xs">Cadastre-se gratuitamente e comece a usar hoje mesmo.</p>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="md:hidden px-6 pt-12 pb-6"
          style={{ background: "linear-gradient(135deg,#1A6FE0,#13A768)" }}>
          <button onClick={() => go("login")} className="flex items-center gap-1 text-white/80 text-sm mb-4">
            <IcoBack cls="w-4 h-4" /> Voltar
          </button>
          <h1 className="text-2xl font-700 text-white" style={{ fontFamily: "Outfit" }}>Criar conta</h1>
        </div>
        <div className="flex-1 bg-white rounded-t-3xl md:rounded-none -mt-3 md:mt-0 px-6 py-8 md:flex md:items-center md:justify-center md:px-16 lg:px-24">
          <div className="w-full max-w-sm flex flex-col gap-4">
            <div className="hidden md:block mb-2">
              <button onClick={() => go("login")} className="flex items-center gap-1 text-[#1A6FE0] text-sm font-500 mb-4">
                <IcoBack cls="w-4 h-4" /> Voltar
              </button>
              <h2 className="text-2xl font-700 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>Criar conta</h2>
            </div>
            <Field label="Nome completo"><input placeholder="Ana Paula Ferreira" className={fieldCls(false)} /></Field>
            <Field label="E-mail"><input type="email" placeholder="ana@escola.edu.br" className={fieldCls(false)} /></Field>
            <Field label="Senha"><input type="password" placeholder="••••••••" className={fieldCls(false)} /></Field>
            <Field label="Confirmar senha"><input type="password" placeholder="••••••••" className={fieldCls(false)} /></Field>
            <Field label="Disciplinas que leciona">
              <div className="flex flex-wrap gap-2">
                {disciplinas.map((d) => (
                  <button key={d} onClick={() => toggle(d)}
                    className="px-3 py-1.5 rounded-full text-sm font-500 border transition-all"
                    style={{ background: sel.includes(d) ? "#1A6FE0" : "transparent", color: sel.includes(d) ? "#fff" : "#6B7A9A", borderColor: sel.includes(d) ? "#1A6FE0" : "#E1E8F5" }}>
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <Btn onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); go("home"); }, 900); }} loading={loading} primary>Cadastrar</Btn>
            <p className="text-center text-sm text-[#6B7A9A]">Já tem conta? <button onClick={() => go("login")} className="text-[#1A6FE0] font-600">Entrar</button></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HOME ──────────────────────────────────────────────────────────────
function HomeScreen({ turmas, chamadas, go, setActiveTurma }: {
  turmas: Turma[]; chamadas: Chamada[]; go: (s: Screen) => void; setActiveTurma: (t: Turma) => void;
}) {
  const semana = chamadas.filter((c) => (new Date().getTime() - new Date(c.data).getTime()) / 86400000 <= 7);

  return (
    <div className="pb-24 md:pb-8">
      {/* Hero */}
      <div className="px-5 md:px-8 pt-8 pb-7"
        style={{ background: "linear-gradient(135deg,#1A6FE0 0%,#13A768 100%)" }}>
          <p className="text-white/70 text-sm">{fmtDate(hoje)}</p>
        <h2 className="text-2xl md:text-3xl font-700 text-white mt-1" style={{ fontFamily: "Outfit" }}>
          Olá! 👋
        </h2>
        <p className="text-white/70 text-sm mt-1">Bem-vinda de volta ao Turma Fácil Brasil</p>
      </div>

      <div className="px-4 md:px-8 -mt-4 flex flex-col gap-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 md:gap-4 max-w-2xl">
          {[
            { label: "Turmas ativas", value: turmas.length, color: "#1A6FE0", bg: "#EBF2FF" },
            { label: "Chamadas esta semana", value: semana.length, color: "#13A768", bg: "#E6F9F1" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className="bg-white rounded-2xl p-3 md:p-5 shadow-sm border border-[#E1E8F5] flex flex-col items-center md:items-start gap-1 md:gap-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: bg }}>
                <span className="text-lg font-800" style={{ color, fontFamily: "Outfit" }}>{value}</span>
              </div>
              <span className="text-[11px] md:text-sm text-center md:text-left text-[#6B7A9A] leading-tight">{label}</span>
            </div>
          ))}
        </div>

        {/* Turmas */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base md:text-lg font-700 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>Minhas Turmas</h3>
            <button onClick={() => go("turmas")} className="text-sm text-[#1A6FE0] font-500 hover:underline">Ver todas</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {turmas.map((t) => (
              <TurmaCard key={t.id} turma={t}
                onOpen={() => { setActiveTurma(t); go("turma-detail"); }}
                onChamada={() => { setActiveTurma(t); go("chamada"); }}
                onNotas={() => { setActiveTurma(t); go("lancamento-notas"); }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* FAB mobile */}
      <button onClick={() => go("criar-turma")}
        className="md:hidden fixed bottom-20 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40 transition-transform active:scale-95"
        style={{ background: "#1A6FE0" }}>
        <IcoPlus cls="w-7 h-7 text-white" />
      </button>

      {/* Desktop CTA */}
      <div className="hidden md:flex px-8 mt-4">
        <button onClick={() => go("criar-turma")}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-700 text-white transition-all hover:opacity-90"
          style={{ background: "#1A6FE0", fontFamily: "Outfit" }}>
          <IcoPlus cls="w-5 h-5" /> Criar nova turma
        </button>
      </div>
    </div>
  );
}

// ── TURMAS ────────────────────────────────────────────────────────────
function TurmasScreen({ turmas, go, setActiveTurma }: {
  turmas: Turma[]; go: (s: Screen) => void; setActiveTurma: (t: Turma) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = turmas.filter((t) =>
    t.nome.toLowerCase().includes(q.toLowerCase()) ||
    t.escola.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="pb-24 md:pb-8">
      <Header title="Turmas" subtitle={`${turmas.length} turmas cadastradas`} />
      <div className="px-4 md:px-8 pt-4 flex flex-col gap-4">
        <div className="flex gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar turma ou escola..."
            className="flex-1 bg-white border border-[#E1E8F5] rounded-xl pl-4 pr-4 py-2.5 text-sm outline-none focus:border-[#1A6FE0]" />
          <button onClick={() => go("criar-turma")}
            className="hidden md:flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-700 text-white flex-shrink-0"
            style={{ background: "#1A6FE0", fontFamily: "Outfit" }}>
            <IcoPlus cls="w-4 h-4" /> Nova turma
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {filtered.map((t) => (
            <TurmaCard key={t.id} turma={t}
              onOpen={() => { setActiveTurma(t); go("turma-detail"); }}
              onChamada={() => { setActiveTurma(t); go("chamada"); }}
              onNotas={() => { setActiveTurma(t); go("lancamento-notas"); }}
            />
          ))}
        </div>
        {!filtered.length && <p className="text-center text-[#6B7A9A] text-sm py-10">Nenhuma turma encontrada</p>}
      </div>
      <button onClick={() => go("criar-turma")}
        className="md:hidden fixed bottom-20 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-40"
        style={{ background: "#1A6FE0" }}>
        <IcoPlus cls="w-7 h-7 text-white" />
      </button>
    </div>
  );
}

// ── TURMA DETAIL ──────────────────────────────────────────────────────
function TurmaDetailScreen({ turma, chamadas, notas, composicao, go, setActiveTurma, onSaveComposicao }: {
  turma: Turma; chamadas: Chamada[]; notas: Record<number, NotaAluno>; composicao?: ComposicaoNota | Record<string, number>; go: (s: Screen) => void;
  setActiveTurma: (t: Turma) => void; onSaveComposicao: (value: ComposicaoNota) => void;
}) {
  const [tab, setTab] = useState<"alunos" | "geral" | "chamada" | "notas">("alunos");
  const [showComposition, setShowComposition] = useState(!composicao);
  const [composition, setComposition] = useState<ComposicaoNota>(() => normalizeComposicao(composicao));
  const turmaChamadas = chamadas.filter((c) => c.turmaId === turma.id);
  const updateComposition = (id: string, key: "nome" | "peso", value: string) => setComposition((current) => ({
    itens: current.itens.map((item) => item.id === id ? { ...item, [key]: key === "peso" ? Number(value) || 0 : value } : item),
  }));
  const addCompositionItem = () => setComposition((current) => ({
    itens: [...current.itens, { id: `item-${Date.now()}`, nome: "Nova avaliação", peso: 0 }],
  }));
  const removeCompositionItem = (id: string) => setComposition((current) => ({ itens: current.itens.filter((item) => item.id !== id) }));
  const compositionTotal = composition.itens.reduce((sum, item) => sum + item.peso, 0);

  return (
    <div className="pb-24 md:pb-8">
      <Header title={turma.nome} subtitle={`${turma.escola} · ${turma.disciplina}`} onBack={() => go("turmas")} />

      {/* Chips */}
      <div className="px-4 md:px-8 py-3 bg-white border-b border-[#E1E8F5]">
        <div className="flex flex-wrap gap-2 text-xs">
          {[turma.turno, turma.serie, `${turma.anoLetivo}`, `${turma.bimestre}º Bim`].map((v) => (
            <span key={v} className="px-2.5 py-1 bg-[#F4F7FE] rounded-full text-[#6B7A9A] font-500">{v}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white border-b border-[#E1E8F5] px-4 md:px-8 sticky top-[57px] z-30">
        {(["alunos", "geral", "chamada", "notas"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="py-3 px-4 text-sm font-600 border-b-2 transition-colors"
            style={{ fontFamily: "Outfit", color: tab === t ? "#1A6FE0" : "#6B7A9A", borderColor: tab === t ? "#1A6FE0" : "transparent" }}>
            {t === "alunos" ? "Alunos" : t === "geral" ? "Geral" : t === "chamada" ? "Chamadas" : "Notas"}
          </button>
        ))}
      </div>

      <div className="px-4 md:px-8 pt-5">
        {tab === "alunos" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {turma.alunos.map((a, i) => (
              <div key={a.id} className="bg-white rounded-xl p-3 flex items-center gap-3 border border-[#E1E8F5]">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-700 flex-shrink-0"
                  style={{ background: "#1A6FE0", fontFamily: "Outfit" }}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-600 text-[#1A2340] truncate">{a.nome}</p>
                  <p className="text-xs text-[#6B7A9A]">Mat. {a.matricula}</p>
                </div>
                {(() => { const frequency = frequenciaAluno(a.id, turmaChamadas); return (
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-700 ${frequency.total && frequency.percentual < 75 ? "text-[#E63946]" : "text-[#13A768]"}`}>{frequency.total ? `${frequency.percentual.toFixed(0)}%` : "—"}</p>
                    <p className="text-[10px] text-[#6B7A9A]">{frequency.total ? `${frequency.faltas} falta(s) · ${frequency.percentual < 75 ? "Reprovado" : "Aprovado"}` : "Sem chamadas"}</p>
                  </div>
                ); })()}
              </div>
            ))}
            <p className="text-xs text-[#6B7A9A] col-span-full text-center py-2">{turma.alunos.length} alunos</p>
          </div>
        )}

        {tab === "geral" && (
          <div className="overflow-x-auto rounded-2xl border border-[#E1E8F5] bg-white shadow-sm">
            <table className="w-full text-xs border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-[#1A6FE0] text-white">
                  <th className="text-left px-3 py-3">Aluno</th>
                  {[...turmaChamadas].sort((a, b) => a.data.localeCompare(b.data)).map((chamada) => (
                    <th key={chamada.id} className="px-2 py-3 text-center">{fmtDate(chamada.data).slice(0, 5)}</th>
                  ))}
                  <th className="px-3 py-3 text-center">Frequência</th>
                  {composition.itens.map((item) => <th key={item.id} className="px-3 py-3 text-center" title={`Peso: ${item.peso}%`}>{item.nome}<br /><span className="font-400">{item.peso}%</span></th>)}
                  <th className="px-3 py-3 text-center">Média (0-10)</th>
                </tr>
              </thead>
              <tbody>
                {turma.alunos.map((aluno, index) => {
                  const frequency = frequenciaAluno(aluno.id, turmaChamadas);
                  return <tr key={aluno.id} className={index % 2 ? "bg-[#F8FAFF]" : "bg-white"}>
                    <td className="px-3 py-2 font-500 text-[#1A2340] whitespace-nowrap">{aluno.nome}</td>
                    {[...turmaChamadas].sort((a, b) => a.data.localeCompare(b.data)).map((chamada) => {
                      const status = chamada.presencas[aluno.id] || "P";
                      return <td key={chamada.id} className={`px-2 py-2 text-center font-700 ${status === "P" ? "text-[#13A768]" : status === "F" ? "text-[#E63946]" : "text-[#F4A11A]"}`}>{status}</td>;
                    })}
                    <td className={`px-3 py-2 text-center font-700 ${frequency.total && frequency.percentual < 75 ? "text-[#E63946]" : "text-[#13A768]"}`}>{frequency.total ? `${frequency.percentual.toFixed(0)}%` : "—"}</td>
                    {composition.itens.map((item) => <td key={item.id} className="px-3 py-2 text-center text-[#1A2340]">{notas[aluno.id]?.[item.id] || "—"}</td>)}
                    <td className="px-3 py-2 text-center font-700 text-[#1A6FE0]">{notas[aluno.id] ? (calcMediaPonderada(notas[aluno.id], composition) || "—") : "—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
            <p className="px-3 py-3 text-xs text-[#6B7A9A]">P = presente · F = falta · FJ = falta justificada · abaixo de 75%: reprovado por frequência.</p>
          </div>
        )}

        {tab === "chamada" && (
          <div className="flex flex-col gap-3 max-w-xl">
            <div className="flex gap-3">
              <Btn onClick={() => { setActiveTurma(turma); go("chamada"); }} primary cls="flex-1">+ Nova chamada</Btn>
              <button onClick={() => { setActiveTurma(turma); go("historico-chamadas"); }}
                className="flex-1 border border-[#E1E8F5] rounded-xl py-3 text-sm font-600 text-[#1A6FE0] hover:bg-[#EBF2FF] transition-colors"
                style={{ fontFamily: "Outfit" }}>Ver histórico</button>
            </div>
            {turmaChamadas.map((c) => {
              const p = Object.values(c.presencas).filter((v) => v === "P").length;
              const f = Object.values(c.presencas).filter((v) => v === "F").length;
              return (
                <div key={c.id} className="bg-white border border-[#E1E8F5] rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#EBF2FF] flex items-center justify-center flex-shrink-0">
                    <IcoCalendar cls="w-5 h-5 text-[#1A6FE0]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-600 text-[#1A2340]">{fmtDate(c.data)}</p>
                    <p className="text-xs text-[#6B7A9A]">{p} presentes · {f} faltas</p>
                  </div>
                </div>
              );
            })}
            {!turmaChamadas.length && <p className="text-sm text-[#6B7A9A] text-center py-4">Nenhuma chamada registrada</p>}
          </div>
        )}

        {tab === "notas" && (
          <div className="flex flex-col gap-3 max-w-sm">
            <button onClick={() => setShowComposition((current) => !current)} className="text-left text-sm font-600 text-[#1A6FE0] hover:underline">Configurar composição da média</button>
            {showComposition && <div className="bg-white border border-[#E1E8F5] rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm font-700 text-[#1A2340]">Como a média será composta?</p>
              {composition.itens.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <input value={item.nome} onChange={(event) => updateComposition(item.id, "nome", event.target.value)} className="min-w-0 flex-1 border border-[#E1E8F5] rounded-lg px-2 py-1.5 text-sm" placeholder="Nome da avaliação" />
                  <input type="number" min="0" max="100" value={item.peso} onChange={(event) => updateComposition(item.id, "peso", event.target.value)} className="w-20 border border-[#E1E8F5] rounded-lg px-2 py-1.5 text-right text-sm" aria-label={`Peso de ${item.nome}`} />
                  <button type="button" onClick={() => removeCompositionItem(item.id)} className="text-[#E63946] text-lg px-1" aria-label={`Remover ${item.nome}`}>×</button>
                </div>
              ))}
              <button type="button" onClick={addCompositionItem} className="text-left text-sm font-600 text-[#1A6FE0] hover:underline">+ Adicionar posição de nota</button>
              <p className={`text-xs ${compositionTotal === 100 ? "text-[#13A768]" : "text-[#E63946]"}`}>Total dos pesos: {compositionTotal}%</p>
              <Btn onClick={() => { if (compositionTotal === 100) { onSaveComposicao(composition); setShowComposition(false); } }} primary cls={compositionTotal !== 100 ? "opacity-50" : ""}>Salvar composição</Btn>
            </div>}
            <Btn onClick={() => { if (composicao) { setActiveTurma(turma); go("lancamento-notas"); } }} primary cls={!composicao ? "opacity-50" : ""}>Lançar / editar notas</Btn>
            <p className="text-xs text-[#6B7A9A] text-center">Bimestre {turma.bimestre} · {turma.anoLetivo}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CRIAR TURMA ───────────────────────────────────────────────────────
function CriarTurmaScreen({ escolas, go, onSave, onAddEscola }: {
  escolas: Escola[]; go: (s: Screen) => void; onSave: (t: Turma) => void; onAddEscola: (e: Escola) => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "", escola: "", turno: "" as Turno | "",
    serie: "", disciplina: "", anoLetivo: "2026", bimestre: "1",
  });
  const [uploadState, setUploadState] = useState<"idle" | "loading" | "done">("idle");
  const [uploadError, setUploadError] = useState("");
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [novoNome, setNovoNome] = useState("");
  const [showNovaEscola, setShowNovaEscola] = useState(false);
  const [novaEscola, setNovaEscola] = useState({ nome: "", cidade: "", estado: "PA", rede: "Estadual" as Escola["rede"] });
  const fileRef = useRef<HTMLInputElement>(null);
  async function processFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Selecione um arquivo PDF.");
      return;
    }

    setUploadError("");
    setUploadState("loading");
    try {
      const names = await extractStudentNames(file);
      if (!names.length) throw new Error("Nenhum nome foi encontrado na seção ALUNO.");
      setAlunos(names.map((nome, index) => ({ id: Date.now() + index, nome, matricula: "" })));
      setUploadState("done");
    } catch (error) {
      setUploadState("idle");
      setUploadError(error instanceof Error ? error.message : "Não foi possível ler o PDF.");
    }
  }

  function addAluno() {
    if (!novoNome.trim()) return;
    setAlunos((p) => [...p, { id: Date.now(), nome: novoNome, matricula: "" }]);
    setNovoNome("");
  }

  function addNovaEscola() {
    if (!novaEscola.nome.trim()) return;
    const escola = { id: Date.now(), ...novaEscola, nome: novaEscola.nome.trim() };
    onAddEscola(escola);
    f("escola", escola.nome);
    setNovaEscola({ nome: "", cidade: "", estado: "PA", rede: "Estadual" });
    setShowNovaEscola(false);
  }

  function save() {
    onSave({
      id: Date.now(), nome: form.nome || "Nova Turma",
      escola: form.escola || escolas[0]?.nome || "",
      turno: (form.turno || "Manhã") as Turno,
      serie: form.serie || "1º Ano", disciplina: form.disciplina || "—",
      anoLetivo: parseInt(form.anoLetivo), bimestre: parseInt(form.bimestre), alunos,
    });
    go("turmas");
  }

  const f = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="pb-24 md:pb-8">
      <Header title="Criar Turma" onBack={() => step > 1 ? setStep((s) => s - 1) : go("turmas")} />
      <div className="px-4 md:px-8 pt-5">
        {/* Steps bar */}
        <div className="flex gap-1.5 mb-1">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex-1 h-1.5 rounded-full transition-all"
              style={{ background: s <= step ? "#1A6FE0" : "#E1E8F5" }} />
          ))}
        </div>
        <p className="text-xs text-[#6B7A9A] mb-6">Etapa {step} de 3 — {["Dados da turma", "Importar alunos", "Confirmação"][step - 1]}</p>

        <div className="max-w-xl">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nome da turma" cls="md:col-span-2">
                  <input value={form.nome} onChange={(e) => f("nome", e.target.value)} placeholder="Ex: Zootecnia 2026" className={fieldCls(false)} />
                </Field>
                <Field label="Escola" cls="md:col-span-2">
                  <select value={form.escola} onChange={(e) => f("escola", e.target.value)} className={fieldCls(false)}>
                    <option value="">Selecione uma escola</option>
                    {escolas.map((e) => <option key={e.id} value={e.nome}>{e.nome}</option>)}
                  </select>
                  {!showNovaEscola && (
                    <button type="button" onClick={() => setShowNovaEscola(true)}
                      className="self-start text-xs font-600 text-[#1A6FE0] hover:underline">
                      + Cadastrar nova escola
                    </button>
                  )}
                  {showNovaEscola && (
                    <div className="mt-1 rounded-xl border border-[#C5D5F0] bg-[#F8FAFF] p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-700 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>Cadastrar nova escola</p>
                        <button type="button" onClick={() => setShowNovaEscola(false)}><IcoClose cls="w-4 h-4 text-[#6B7A9A]" /></button>
                      </div>
                      <input value={novaEscola.nome} onChange={(e) => setNovaEscola((p) => ({ ...p, nome: e.target.value }))}
                        placeholder="Nome da escola" className={fieldCls(false)} />
                      <div className="flex gap-2">
                        <input value={novaEscola.cidade} onChange={(e) => setNovaEscola((p) => ({ ...p, cidade: e.target.value }))}
                          placeholder="Cidade" className={`${fieldCls(false)} flex-1`} />
                        <input value={novaEscola.estado} onChange={(e) => setNovaEscola((p) => ({ ...p, estado: e.target.value.toUpperCase() }))}
                          placeholder="UF" maxLength={2} className={`${fieldCls(false)} w-20`} />
                      </div>
                      <select value={novaEscola.rede} onChange={(e) => setNovaEscola((p) => ({ ...p, rede: e.target.value as Escola["rede"] }))} className={fieldCls(false)}>
                        {["Estadual", "Municipal", "Privada"].map((rede) => <option key={rede}>{rede}</option>)}
                      </select>
                      <button type="button" onClick={addNovaEscola} disabled={!novaEscola.nome.trim()}
                        className="py-2.5 rounded-xl text-sm font-700 text-white disabled:opacity-50"
                        style={{ background: "#1A6FE0", fontFamily: "Outfit" }}>
                        Salvar e selecionar escola
                      </button>
                    </div>
                  )}
                </Field>
                <Field label="Turno" cls="md:col-span-2">
                  <div className="flex gap-2">
                    {(["Manhã", "Tarde", "Noite"] as Turno[]).map((t) => (
                      <button key={t} onClick={() => f("turno", t)}
                        className="flex-1 py-2.5 rounded-xl text-sm font-600 border transition-all"
                        style={{ fontFamily: "Outfit", background: form.turno === t ? "#1A6FE0" : "white", color: form.turno === t ? "white" : "#6B7A9A", borderColor: form.turno === t ? "#1A6FE0" : "#E1E8F5" }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Ano / Série">
                  <input value={form.serie} onChange={(e) => f("serie", e.target.value)} placeholder="Ex: 5ª Fase" className={fieldCls(false)} />
                </Field>
                <Field label="Disciplina">
                  <input value={form.disciplina} onChange={(e) => f("disciplina", e.target.value)} placeholder="Ex: Biologia Animal" className={fieldCls(false)} />
                </Field>
                <Field label="Ano letivo">
                  <input type="number" value={form.anoLetivo} onChange={(e) => f("anoLetivo", e.target.value)} className={fieldCls(false)} />
                </Field>
                <Field label="Bimestre">
                  <select value={form.bimestre} onChange={(e) => f("bimestre", e.target.value)} className={fieldCls(false)}>
                    {[1,2,3,4].map((b) => <option key={b} value={b}>{b}º Bimestre</option>)}
                  </select>
                </Field>
              </div>
              <Btn onClick={() => setStep(2)} primary>Próximo</Btn>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              {uploadState === "idle" && (
                <>
                  <div onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-[#C5D5F0] rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-[#1A6FE0] hover:bg-[#EBF2FF] transition-all"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); void processFile(e.dataTransfer.files[0]); }}>
                    <div className="w-14 h-14 rounded-2xl bg-[#EBF2FF] flex items-center justify-center">
                      <IcoUpload cls="w-7 h-7 text-[#1A6FE0]" />
                    </div>
                    <p className="text-sm font-600 text-[#1A2340]">Arraste o arquivo ou clique para selecionar</p>
                    <p className="text-xs text-[#6B7A9A] text-center max-w-xs">Envie a caderneta em PDF e o sistema extrai apenas os nomes dos alunos</p>
                    <span className="text-xs px-3 py-1.5 border border-[#E1E8F5] rounded-lg text-[#6B7A9A]">PDF</span>
                  </div>
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void processFile(e.target.files?.[0])} />
                  <Btn onClick={() => fileRef.current?.click()}>Selecionar PDF</Btn>
                  {uploadError && <p className="text-xs text-[#E63946] text-center">{uploadError}</p>}
                  <div className="flex items-center gap-2 text-xs text-[#6B7A9A]">
                    <div className="flex-1 h-px bg-[#E1E8F5]" /> ou adicione manualmente <div className="flex-1 h-px bg-[#E1E8F5]" />
                  </div>
                </>
              )}

              {uploadState === "loading" && (
                <div className="flex flex-col items-center gap-4 py-14">
                  <div className="w-14 h-14 rounded-2xl bg-[#EBF2FF] flex items-center justify-center">
                    <div className="w-7 h-7 border-3 border-[#1A6FE0] border-t-transparent rounded-full animate-spin" />
                  </div>
                  <p className="text-sm font-600 text-[#1A2340]">Lendo documento...</p>
                  <p className="text-xs text-[#6B7A9A]">Identificando nomes dos alunos</p>
                </div>
              )}

              {uploadState === "done" && (
                <div className="bg-[#E6F9F1] rounded-xl p-3 flex items-center gap-2 mb-1">
                  <IcoCheck cls="w-5 h-5 text-[#13A768]" />
                  <p className="text-sm font-600 text-[#13A768]">{alunos.length} alunos identificados — revise antes de confirmar</p>
                </div>
              )}

              {(uploadState === "idle" || uploadState === "done") && (
                <>
                  <div className="flex gap-2">
                    <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
                      placeholder="Adicionar aluno manualmente" className={`${fieldCls(false)} flex-1`}
                      onKeyDown={(e) => e.key === "Enter" && addAluno()} />
                    <button onClick={addAluno} className="px-3 py-2.5 bg-[#EBF2FF] rounded-xl text-[#1A6FE0] hover:bg-[#D6E8FF] transition-colors">
                      <IcoPlus cls="w-5 h-5" />
                    </button>
                  </div>
                  {alunos.length > 0 && (
                    <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                      {alunos.map((a, i) => (
                        <div key={a.id} className="flex items-center gap-2 bg-white border border-[#E1E8F5] rounded-xl px-3 py-2">
                          <span className="text-xs font-700 text-[#1A6FE0] w-6">{i + 1}</span>
                          <span className="flex-1 text-sm text-[#1A2340]">{a.nome}</span>
                          <button onClick={() => setAlunos((p) => p.filter((x) => x.id !== a.id))}>
                            <IcoClose cls="w-4 h-4 text-[#6B7A9A] hover:text-[#E63946]" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {alunos.length > 0 && <Btn onClick={() => setStep(3)} primary>Revisar e continuar</Btn>}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-2xl border border-[#E1E8F5] divide-y divide-[#E1E8F5]">
                {[["Nome", form.nome||"—"],["Escola", form.escola||"—"],["Turno", form.turno||"—"],["Série", form.serie||"—"],["Disciplina", form.disciplina||"—"],["Ano letivo", form.anoLetivo],["Bimestre", `${form.bimestre}º`],["Total de alunos", alunos.length]].map(([label, val]) => (
                  <div key={String(label)} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-[#6B7A9A]">{label}</span>
                    <span className="text-sm font-600 text-[#1A2340]">{val}</span>
                  </div>
                ))}
              </div>
              <Btn onClick={save} primary>Criar turma</Btn>
              <button onClick={() => setStep(2)} className="text-center text-sm text-[#1A6FE0] font-500 py-1 hover:underline">Voltar para editar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CHAMADA ───────────────────────────────────────────────────────────
function ChamadaScreen({ turma, chamada, go, onSave }: {
  turma: Turma; chamada?: Chamada; go: (s: Screen) => void; onSave: (c: Chamada) => void;
}) {
  const [data, setData] = useState(chamada?.data || hoje);
  const [presencas, setPresencas] = useState<Record<number, Presenca>>(() => {
    const r: Record<number, Presenca> = {};
    turma.alunos.forEach((a) => { r[a.id] = chamada?.presencas[a.id] || "P"; });
    return r;
  });

  function toggle(id: number) {
    setPresencas((p) => {
      const seq: Record<Presenca, Presenca> = { P: "F", F: "FJ", FJ: "P" };
      return { ...p, [id]: seq[p[id]] };
    });
  }
  function marcarTodos() {
    const r: Record<number, Presenca> = {};
    turma.alunos.forEach((a) => { r[a.id] = "P"; });
    setPresencas(r);
  }

  const vals = Object.values(presencas);
  const pCount = vals.filter((v) => v === "P").length;
  const fCount = vals.filter((v) => v === "F").length;
  const fjCount = vals.filter((v) => v === "FJ").length;

  const pCfg: Record<Presenca, { bg: string; color: string }> = {
    P: { bg: "#E6F9F1", color: "#13A768" },
    F: { bg: "#FEE2E2", color: "#E63946" },
    FJ: { bg: "#FEF3E2", color: "#F4A11A" },
  };

  function save() {
    onSave({ id: chamada?.id || Date.now(), turmaId: turma.id, data, presencas });
    go("turma-detail");
  }

  return (
    <div className="pb-28 md:pb-8">
      <Header title={chamada ? "Editar chamada" : "Fazer chamada"} subtitle={`${turma.nome} · ${turma.escola}`} onBack={() => go("turma-detail")} />

      <div className="px-4 md:px-8 pt-4 flex flex-col gap-4 max-w-2xl">
        {/* Info bar */}
        <div className="bg-white rounded-2xl border border-[#E1E8F5] p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <IcoCalendar cls="w-4 h-4 text-[#6B7A9A]" />
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              className="text-sm font-600 text-[#1A2340] bg-transparent outline-none" />
          </div>
          <div className="flex gap-4 text-sm font-600 ml-auto">
            <span className="text-[#13A768]">{pCount} presentes</span>
            <span className="text-[#E63946]">{fCount} faltas</span>
            {fjCount > 0 && <span className="text-[#F4A11A]">{fjCount} just.</span>}
          </div>
        </div>

        <button onClick={marcarTodos}
          className="flex items-center justify-center gap-2 py-2.5 border border-[#1A6FE0] rounded-xl text-sm font-600 text-[#1A6FE0] hover:bg-[#EBF2FF] transition-colors"
          style={{ fontFamily: "Outfit" }}>
          <IcoCheck cls="w-4 h-4" /> Marcar todos presentes
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {turma.alunos.map((a, i) => {
            const est = presencas[a.id];
            const cfg = pCfg[est];
            return (
              <div key={a.id} className="bg-white border border-[#E1E8F5] rounded-xl flex items-center px-3 py-2.5 gap-3 hover:border-[#C5D5F0] transition-colors">
                <span className="text-xs text-[#6B7A9A] w-5 text-right flex-shrink-0">{i + 1}</span>
                <span className="flex-1 text-sm text-[#1A2340] truncate">{a.nome}</span>
                <button onClick={() => toggle(a.id)}
                  className="w-12 h-8 rounded-lg font-700 text-xs transition-all flex-shrink-0"
                  style={{ background: cfg.bg, color: cfg.color, fontFamily: "Outfit" }}>
                  {est}
                </button>
              </div>
            );
          })}
        </div>

        {/* Desktop save button inline */}
        <div className="hidden md:block">
          <Btn onClick={save} primary>Salvar chamada</Btn>
        </div>
      </div>

      {/* Mobile sticky footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E1E8F5] px-4 py-3 z-40">
        <div className="flex items-center justify-around mb-2 text-xs text-[#6B7A9A]">
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#E6F9F1] mr-1" />P = Presente</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#FEE2E2] mr-1" />F = Falta</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#FEF3E2] mr-1" />FJ = Justificada</span>
        </div>
        <Btn onClick={save} primary>Salvar chamada</Btn>
      </div>
    </div>
  );
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────
function HistoricoScreen({ turma, chamadas, go, onEdit }: {
  turma: Turma; chamadas: Chamada[]; go: (s: Screen) => void; onEdit: (chamada: Chamada) => void;
}) {
  const [detail, setDetail] = useState<Chamada | null>(null);
  const turmaChamadas = chamadas.filter((c) => c.turmaId === turma.id).sort((a, b) => b.data.localeCompare(a.data));

  if (detail) {
    const pCount = Object.values(detail.presencas).filter((v) => v === "P").length;
    const fCount = Object.values(detail.presencas).filter((v) => v === "F").length;
    const colors: Record<Presenca, { bg: string; color: string }> = {
      P: { bg: "#E6F9F1", color: "#13A768" },
      F: { bg: "#FEE2E2", color: "#E63946" },
      FJ: { bg: "#FEF3E2", color: "#F4A11A" },
    };
    return (
      <div className="pb-24 md:pb-8">
        <Header title={`Chamada — ${fmtDate(detail.data)}`} subtitle={turma.nome} onBack={() => setDetail(null)} />
        <div className="px-4 md:px-8 pt-5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex gap-4 text-sm font-600 mr-auto">
              <span className="text-[#13A768]">{pCount} presentes</span>
              <span className="text-[#E63946]">{fCount} faltas</span>
            </div>
            <button onClick={() => onEdit(detail)} className="px-3 py-2 rounded-lg text-xs font-600 text-[#1A6FE0] border border-[#C5D5F0] hover:bg-[#EBF2FF]">Editar</button>
            <button onClick={() => exportChamadaPdf(turma, detail)} className="px-3 py-2 rounded-lg text-xs font-600 text-[#E63946] border border-[#FECACA] hover:bg-[#FFF5F5]">PDF</button>
            <button onClick={() => exportChamadaExcel(turma, detail)} className="px-3 py-2 rounded-lg text-xs font-600 text-[#13A768] border border-[#BBF7D0] hover:bg-[#E6F9F1]">Excel</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {turma.alunos.map((a, i) => {
              const p = detail.presencas[a.id] || "P";
              return (
                <div key={a.id} className="bg-white border border-[#E1E8F5] rounded-xl flex items-center px-3 py-2.5 gap-3">
                  <span className="text-xs text-[#6B7A9A] w-5">{i + 1}</span>
                  <span className="flex-1 text-sm text-[#1A2340] truncate">{a.nome}</span>
                  <span className="w-12 h-7 rounded-lg font-700 text-xs flex items-center justify-center"
                    style={{ background: colors[p].bg, color: colors[p].color, fontFamily: "Outfit" }}>{p}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-8">
      <Header title="Histórico de Chamadas" subtitle={`${turma.nome} · ${turma.escola}`} onBack={() => go("turma-detail")} />
      <div className="px-4 md:px-8 pt-5 max-w-2xl flex flex-col gap-3">
        {turmaChamadas.map((c) => {
          const p = Object.values(c.presencas).filter((v) => v === "P").length;
          const f = Object.values(c.presencas).filter((v) => v === "F").length;
          return (
            <button key={c.id} onClick={() => setDetail(c)}
              className="bg-white border border-[#E1E8F5] rounded-xl p-3.5 flex items-center gap-3 text-left w-full hover:border-[#1A6FE0] hover:shadow-sm transition-all">
              <div className="w-10 h-10 rounded-xl bg-[#EBF2FF] flex items-center justify-center flex-shrink-0">
                <IcoCalendar cls="w-5 h-5 text-[#1A6FE0]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-700 text-[#1A2340]">{fmtDate(c.data)}</p>
                <p className="text-xs text-[#6B7A9A]">
                  <span className="text-[#13A768] font-500">{p} presentes</span> · <span className="text-[#E63946] font-500">{f} faltas</span>
                </p>
              </div>
              <IcoChevron cls="w-4 h-4 text-[#6B7A9A]" />
            </button>
          );
        })}
        {!turmaChamadas.length && <p className="text-center text-[#6B7A9A] text-sm py-10">Nenhuma chamada registrada</p>}
      </div>
    </div>
  );
}

// ── NOTAS ─────────────────────────────────────────────────────────────
function LancamentoNotasScreen({ turma, go, notasSalvas, composicao, onSave }: {
  turma: Turma; go: (s: Screen) => void; notasSalvas?: Record<number, NotaAluno>;
  composicao: ComposicaoNota; onSave: (notas: Record<number, NotaAluno>) => void;
}) {
  const [notas, setNotas] = useState<Record<number, NotaAluno>>(() => notasSalvas || initNotas(turma.alunos));
  useEffect(() => {
    if (notasSalvas) setNotas(notasSalvas);
  }, [notasSalvas]);
  function setNota(id: number, k: keyof NotaAluno, v: string) {
    setNotas((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  }

  return (
    <div className="pb-28 md:pb-8">
      <Header title="Lançar Notas" subtitle={`${turma.nome} · ${turma.bimestre}º Bimestre · ${turma.anoLetivo}`}
        onBack={() => go("turma-detail")} />

      <div className="px-4 md:px-8 pt-4">
        <div className="overflow-x-auto rounded-2xl border border-[#E1E8F5] bg-white shadow-sm">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr style={{ background: "#1A6FE0" }}>
                <th className="text-left px-3 py-3 text-white font-600 rounded-tl-2xl w-8" style={{ fontFamily: "Outfit" }}>#</th>
                <th className="text-left px-3 py-3 text-white font-600" style={{ fontFamily: "Outfit", minWidth: 140 }}>Aluno</th>
                {composicao.itens.map((item) => (
                  <th key={item.id} className="px-2 py-3 text-white font-600 text-center min-w-20" style={{ fontFamily: "Outfit" }} title={`${item.nome} (${item.peso}%)`}>{item.nome}</th>
                ))}
                <th className="px-2 py-3 text-white font-600 text-center w-14 rounded-tr-2xl" style={{ fontFamily: "Outfit" }}>MÉD</th>
              </tr>
            </thead>
            <tbody>
              {turma.alunos.map((a, i) => {
                const n = notas[a.id] || { ac: "", ae: "", prova: "", outros: "", rec: "" };
                const media = calcMediaPonderada(n, composicao);
                const baixa = !isNaN(parseFloat(media)) && parseFloat(media) < 5;
                return (
                  <tr key={a.id} className={i % 2 === 0 ? "bg-white" : "bg-[#F8FAFF]"}>
                    <td className="px-3 py-2 text-[#6B7A9A] text-center">{i + 1}</td>
                    <td className="px-3 py-2 text-[#1A2340] font-500 truncate max-w-[140px]">
                      {a.nome.split(" ").slice(0, 2).join(" ")}
                    </td>
                    {composicao.itens.map((item) => (
                      <td key={item.id} className="px-1.5 py-1.5 text-center">
                        <input type="number" min="0" max="10" step="0.5"
                          value={n[item.id] || ""} onChange={(e) => setNota(a.id, item.id, e.target.value)}
                          className="w-12 h-7 rounded-lg border border-[#E1E8F5] text-center text-xs font-600 outline-none focus:border-[#1A6FE0] bg-white"
                          inputMode="decimal" aria-label={`${item.nome} para ${a.nome}`} />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <span className="font-700 text-xs" style={{ color: baixa ? "#E63946" : media ? "#13A768" : "#6B7A9A" }}>
                        {media || "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#6B7A9A] mt-2 flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#E63946]" />
          Médias abaixo de 5,0 destacadas em vermelho · Clique na célula para editar
        </p>
        <div className="hidden md:block mt-5 max-w-xs">
          <Btn onClick={() => { onSave(notas); go("turma-detail"); }} primary>Salvar notas</Btn>
        </div>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E1E8F5] px-4 py-3 z-40">
        <Btn onClick={() => { onSave(notas); go("turma-detail"); }} primary>Salvar notas</Btn>
      </div>
    </div>
  );
}

// ── ESCOLAS ───────────────────────────────────────────────────────────
function EscolasScreen({ escolas, turmas, go, onAdd }: {
  escolas: Escola[]; turmas: Turma[]; go: (s: Screen) => void; onAdd: (e: Escola) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", cidade: "", estado: "PA", rede: "Estadual" as Escola["rede"] });
  const sf = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  function save() {
    if (!form.nome.trim()) return;
    onAdd({ id: Date.now(), ...form });
    setForm({ nome: "", cidade: "", estado: "PA", rede: "Estadual" });
    setShowForm(false);
  }

  return (
    <div className="pb-24 md:pb-8">
      <Header title="Escolas" subtitle={`${escolas.length} escola(s) cadastrada(s)`}
        action={{ label: "+ Adicionar", onClick: () => setShowForm(true) }} />
      <div className="px-4 md:px-8 pt-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {escolas.map((e) => {
            const count = turmas.filter((t) => t.escola === e.nome).length;
            return (
              <div key={e.id} className="bg-white border border-[#E1E8F5] rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-all">
                <div className="w-10 h-10 rounded-xl bg-[#EBF2FF] flex items-center justify-center flex-shrink-0">
                  <IcoSchool cls="w-5 h-5 text-[#1A6FE0]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-700 text-sm text-[#1A2340] truncate" style={{ fontFamily: "Outfit" }}>{e.nome}</p>
                  <p className="text-xs text-[#6B7A9A]">{e.cidade}/{e.estado} · {e.rede}</p>
                  <p className="text-xs text-[#1A6FE0] font-500 mt-0.5">{count} turma(s)</p>
                </div>
              </div>
            );
          })}
        </div>

        {showForm && (
          <div className="bg-white border border-[#E1E8F5] rounded-2xl p-5 flex flex-col gap-3 max-w-lg">
            <div className="flex items-center justify-between">
              <h4 className="font-700 text-[#1A2340]" style={{ fontFamily: "Outfit" }}>Nova escola</h4>
              <button onClick={() => setShowForm(false)}><IcoClose cls="w-5 h-5 text-[#6B7A9A]" /></button>
            </div>
            <Field label="Nome da escola"><input value={form.nome} onChange={(e) => sf("nome", e.target.value)} placeholder="Ex: EETEPA Santarém" className={fieldCls(false)} /></Field>
            <div className="flex gap-3">
              <Field label="Cidade" cls="flex-1"><input value={form.cidade} onChange={(e) => sf("cidade", e.target.value)} placeholder="Belém" className={fieldCls(false)} /></Field>
              <Field label="Estado" cls="w-20"><input value={form.estado} onChange={(e) => sf("estado", e.target.value)} placeholder="PA" maxLength={2} className={fieldCls(false)} /></Field>
            </div>
            <Field label="Rede">
              <select value={form.rede} onChange={(e) => sf("rede", e.target.value as Escola["rede"])} className={fieldCls(false)}>
                {["Estadual","Municipal","Privada"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-[#E1E8F5] rounded-xl text-sm font-600 text-[#6B7A9A] hover:bg-[#F4F7FE] transition-colors">Cancelar</button>
              <Btn onClick={save} primary cls="flex-1">Salvar</Btn>
            </div>
          </div>
        )}

        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="border-2 border-dashed border-[#C5D5F0] rounded-2xl py-5 flex items-center justify-center gap-2 text-sm font-600 text-[#1A6FE0] hover:bg-[#EBF2FF] transition-colors max-w-sm"
            style={{ fontFamily: "Outfit" }}>
            <IcoPlus cls="w-5 h-5" /> Adicionar escola
          </button>
        )}
      </div>
    </div>
  );
}

// ── PERFIL ────────────────────────────────────────────────────────────
function PerfilScreen({ go }: { go: (s: Screen) => void }) {
  const [dark, setDark] = useState(false);
  const [notifs, setNotifs] = useState(true);

  return (
    <div className="pb-24 md:pb-8">
      <Header title="Perfil" />
      <div className="w-full px-4 sm:px-6 md:px-8 pt-4 sm:pt-5">
        <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {/* Left col */}
          <div className="flex flex-col gap-4">
            <div className="bg-white rounded-2xl border border-[#E1E8F5] p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-800 flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#1A6FE0,#13A768)", fontFamily: "Outfit" }}>A</div>
              <div className="min-w-0">
                <h3 className="font-700 text-[#1A2340] truncate" style={{ fontFamily: "Outfit" }}>Meu perfil</h3>
                <p className="text-xs sm:text-sm text-[#6B7A9A] truncate">Configure seus dados</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {["Biologia", "Zootecnia"].map((d) => (
                    <span key={d} className="text-xs px-2 py-0.5 bg-[#EBF2FF] text-[#1A6FE0] rounded-full font-500">{d}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E1E8F5] divide-y divide-[#E1E8F5]">
              {[{ label: "Editar dados pessoais" }, { label: "Trocar senha" }].map(({ label }) => (
                <button key={label} className="w-full min-h-12 flex items-center gap-3 px-4 py-3 text-sm text-[#1A2340] hover:bg-[#F4F7FE] transition-colors">
                  <IcoEdit cls="w-4 h-4 text-[#6B7A9A]" />
                  <span className="flex-1 text-left">{label}</span>
                  <IcoChevron cls="w-4 h-4 text-[#6B7A9A]" />
                </button>
              ))}
            </div>
          </div>

          {/* Right col */}
          <div className="flex flex-col gap-4">
            <div className="bg-white rounded-2xl border border-[#E1E8F5] divide-y divide-[#E1E8F5]">
              <div className="flex items-center gap-3 px-4 py-3 min-h-12">
                <span className="flex-1 text-sm text-[#1A2340]">Notificações</span>
                <Toggle on={notifs} onChange={setNotifs} />
              </div>
              <div className="flex items-center gap-3 px-4 py-3 min-h-12">
                <span className="flex-1 text-sm text-[#1A2340]">Tema escuro</span>
                <Toggle on={dark} onChange={setDark} />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E1E8F5] divide-y divide-[#E1E8F5]">
              {[{ label: "Minhas escolas", screen: "escolas" as Screen }, { label: "Minhas turmas", screen: "turmas" as Screen }].map(({ label, screen }) => (
                <button key={label} onClick={() => go(screen)} className="w-full min-h-12 flex items-center gap-3 px-4 py-3 text-sm text-[#1A6FE0] font-500 hover:bg-[#F4F7FE] transition-colors">
                  <span className="flex-1 text-left">{label}</span>
                  <IcoChevron cls="w-4 h-4" />
                </button>
              ))}
            </div>

            <button onClick={() => go("login")}
              className="w-full py-3 rounded-xl border border-[#FEE2E2] text-[#E63946] text-sm font-600 hover:bg-[#FFF5F5] transition-colors flex items-center justify-center gap-2"
              style={{ fontFamily: "Outfit" }}>
              <IcoLogout cls="w-4 h-4" /> Sair da conta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen>("login");
  const [turmas, setTurmas] = useState<Turma[]>([]);
  const [escolas, setEscolas] = useState<Escola[]>([]);
  const [chamadas, setChamadas] = useState<Chamada[]>([]);
  const [notas, setNotas] = useState<Record<number, Record<number, NotaAluno>>>({});
  const [composicoes, setComposicoes] = useState<Record<number, ComposicaoNota | Record<string, number>>>({});
  const [activeTurma, setActiveTurma] = useState<Turma | null>(null);
  const activeTurmaRef = useRef<Turma | null>(null);
  const [editingChamada, setEditingChamada] = useState<Chamada | null>(null);

  function routeToScreen(pathname: string): Screen {
    if (pathname === "/" || pathname === "/home") return "home";
    if (pathname === "/login") return "login";
    if (pathname === "/cadastro") return "cadastro";
    if (pathname === "/turmas") return "turmas";
    if (pathname === "/turmas/nova") return "criar-turma";
    if (pathname === "/escolas") return "escolas";
    if (pathname === "/perfil") return "perfil";
    if (/^\/turmas\/\d+\/chamadas\/historico$/.test(pathname)) return "historico-chamadas";
    if (/^\/turmas\/\d+\/chamadas$/.test(pathname)) return "chamada";
    if (/^\/turmas\/\d+\/notas$/.test(pathname)) return "lancamento-notas";
    if (/^\/turmas\/\d+$/.test(pathname)) return "turma-detail";
    return "turmas";
  }

  useEffect(() => {
    const nextScreen = routeToScreen(location.pathname);
    setScreen(nextScreen);
    const turmaId = location.pathname.match(/^\/turmas\/(\d+)/)?.[1];
    if (turmaId) {
      const turma = turmas.find((item) => String(item.id) === turmaId);
      if (turma) {
        activeTurmaRef.current = turma;
        setActiveTurma(turma);
      }
    }
  }, [location.pathname, turmas]);

  useEffect(() => {
    const unsubTurmas = onValue(dataRef("turmas"), (snapshot) => {
      setTurmas(Object.values(snapshot.val() || {}) as Turma[]);
    });
    const unsubEscolas = onValue(dataRef("escolas"), (snapshot) => {
      setEscolas(Object.values(snapshot.val() || {}) as Escola[]);
    });
    const unsubChamadas = onValue(dataRef("chamadas"), (snapshot) => {
      setChamadas(Object.values(snapshot.val() || {}) as Chamada[]);
    });
    const unsubNotas = onValue(dataRef("notas"), (snapshot) => {
      setNotas((snapshot.val() || {}) as Record<number, Record<number, NotaAluno>>);
    });
    const unsubComposicoes = onValue(dataRef("composicoes"), (snapshot) => {
      setComposicoes((snapshot.val() || {}) as Record<number, ComposicaoNota | Record<string, number>>);
    });
    return () => {
      unsubTurmas();
      unsubEscolas();
      unsubChamadas();
      unsubNotas();
      unsubComposicoes();
    };
  }, []);

  const authScreens: Screen[] = ["login", "cadastro"];
  const isAuth = authScreens.includes(screen);
  const navScreens: Screen[] = ["home", "turmas", "escolas", "perfil"];
  const showNav = navScreens.includes(screen);

  function routeForScreen(s: Screen) {
    const turmaId = activeTurmaRef.current?.id || activeTurma?.id;
    if (s === "login") return "/login";
    if (s === "cadastro") return "/cadastro";
    if (s === "home") return "/";
    if (s === "turmas") return "/turmas";
    if (s === "criar-turma") return "/turmas/nova";
    if (s === "escolas") return "/escolas";
    if (s === "perfil") return "/perfil";
    if (!turmaId) return "/turmas";
    if (s === "chamada") return `/turmas/${turmaId}/chamadas`;
    if (s === "historico-chamadas") return `/turmas/${turmaId}/chamadas/historico`;
    if (s === "lancamento-notas") return `/turmas/${turmaId}/notas`;
    return `/turmas/${turmaId}`;
  }

  function go(s: Screen) {
    if (s === "chamada") setEditingChamada(null);
    navigate(routeForScreen(s));
    window.scrollTo({ top: 0 });
  }
  function selectTurma(turma: Turma) {
    activeTurmaRef.current = turma;
    setActiveTurma(turma);
  }
  function addTurma(t: Turma) { void set(dataRef(`turmas/${t.id}`), t); }
  function addChamada(c: Chamada) { void set(dataRef(`chamadas/${c.id}`), c); }
  function addEscola(e: Escola) { void set(dataRef(`escolas/${e.id}`), e); }
  function saveNotas(turmaId: number, value: Record<number, NotaAluno>) {
    void set(dataRef(`notas/${turmaId}`), value);
  }
  function saveComposicao(turmaId: number, value: ComposicaoNota) {
    void set(dataRef(`composicoes/${turmaId}`), value);
  }

  if (isAuth) {
    return (
      <div className="min-h-screen bg-[#F4F7FE]">
        {screen === "login" && <LoginScreen go={go} />}
        {screen === "cadastro" && <CadastroScreen go={go} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7FE]">
      {showNav && <Sidebar active={screen} go={go} />}
      <PageShell>
        {screen === "home" && <HomeScreen turmas={turmas} chamadas={chamadas} go={go} setActiveTurma={selectTurma} />}
        {screen === "turmas" && <TurmasScreen turmas={turmas} go={go} setActiveTurma={selectTurma} />}
        {screen === "turma-detail" && activeTurma && <TurmaDetailScreen turma={activeTurma} chamadas={chamadas} notas={notas[activeTurma.id] || {}} composicao={composicoes[activeTurma.id]} go={go} setActiveTurma={selectTurma} onSaveComposicao={(value) => saveComposicao(activeTurma.id, value)} />}
        {screen === "criar-turma" && <CriarTurmaScreen escolas={escolas} go={go} onSave={addTurma} onAddEscola={addEscola} />}
        {screen === "chamada" && activeTurma && <ChamadaScreen turma={activeTurma} chamada={editingChamada || undefined} go={go} onSave={addChamada} />}
        {screen === "historico-chamadas" && activeTurma && <HistoricoScreen turma={activeTurma} chamadas={chamadas} go={go}
          onEdit={(chamada) => { setEditingChamada(chamada); navigate(`/turmas/${activeTurma.id}/chamadas`); window.scrollTo({ top: 0 }); }} />}
        {screen === "lancamento-notas" && activeTurma && composicoes[activeTurma.id] && <LancamentoNotasScreen turma={activeTurma} go={go} notasSalvas={notas[activeTurma.id]} composicao={normalizeComposicao(composicoes[activeTurma.id])} onSave={(value) => saveNotas(activeTurma.id, value)} />}
        {(["turma-detail", "chamada", "historico-chamadas", "lancamento-notas"] as Screen[]).includes(screen) && !activeTurma && <RouteFallback go={go} />}
        {screen === "escolas" && <EscolasScreen escolas={escolas} turmas={turmas} go={go} onAdd={addEscola} />}
        {screen === "perfil" && <PerfilScreen go={go} />}
      </PageShell>
      {showNav && <BottomNav active={screen} go={go} />}
    </div>
  );
}

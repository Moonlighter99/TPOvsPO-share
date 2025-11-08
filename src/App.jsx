import React, { useMemo, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from "recharts";
import { put } from "@vercel/blob/client";

/**
 * TPO/PO 대시보드 – V3.4 (교수님 요청사항 반영)
 * ------------------------------------------------------------
 * ✅ 1. (전공별) 레이더: 상위 2개가 아닌, 선택된 모든 전공 표출
 * ✅ 2. (전공별) 시계열: Y축 최소값을 25로 설정 (domain={[25, 'auto']})
 * ✅ 3. (학생별) 필터: 다중 선택/중복 표출 (기존 코드에 이미 반영되어 있었음 - Ctrl/Cmd + Click)
 * ✅ 4. (학생별) 빈 차트: 데이터가 없을 시 안내 메시지 표출
 * ------------------------------------------------------------
 * ✅ Tooltip 소수점 둘째자리 고정
 * ✅ 전공별/학생별 모두 TPO·PO를 한 화면에서 좌우 병렬 비교
 * ✅ 학생별 탭: 전공 필터 + 성적 구간("2점대 이하"/"3점대"/"4점대+") + 학번 연도(2020, 2021 …) – 중복 적용
 * ✅ 모든 필터에 "전체" 옵션 제공 (학기, 전공, 성적구간, 학번연도)
 * ✅ 전공 필터에 "전체 전공" 버튼 추가 – 전공별 탭에서 모든 전공 시리즈가 동시 표출
 * ✅ 업로드 패널 고정 높이 + 스크롤(3줄 높이) – 항목이 많아도 레이아웃 고정
 * ✅ 전공(dept) 컬럼 부재 시 파일명에서 자동 주입(CE/MediaDesign 규칙)
 */

// ------------------------ 유틸 ---------------------------------------------
const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/[^0-9+\-\.eE]/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const fmt2 = (v) => (v === null || v === undefined || v === "" ? "-" : Number(v).toFixed(2));
const norm = (s) => String(s ?? "").trim().replace(/[\s_\-\/]+/g, " ").toUpperCase();

const HEADER_ALIASES = {
  studentId: ["학번", "STUDENT ID", "STUDENT_ID", "SID", "ID", "STUDENTID"],
  name: ["이름", "성명", "NAME"],
  dept: ["학과", "전공", "전공명", "학부전공", "학부/전공", "학부", "DEPARTMENT", "MAJOR", "DEPT"],
  semester: ["학기", "SEMESTER", "TERM", "스냅샷", "SNAPSHOT"],
  gpa: ["GPA", "평점", "평균평점", "학기평점", "전체평점", "누적평점"],
};

const isPO = (k) => /^PO\s*0*(\d+)$/i.test(k.replace(/[._-]/g, " "));
const isTPO = (k) => /^TPO\s*0*(\d+)$/i.test(k.replace(/[._-]/g, " "));
const poIndex = (k) => Number(String(k).replace(/[^\d]/g, ""));
const tpoIndex = (k) => Number(String(k).replace(/[^\d]/g, ""));

function mapHeader(key) {
  const K = norm(key);
  for (const [std, candidates] of Object.entries(HEADER_ALIASES)) {
    if (candidates.some((c) => norm(c) === K)) return std;
  }
  if (isPO(K)) return `PO_${poIndex(K)}`;
  if (isTPO(K)) return `TPO_${tpoIndex(K)}`;
  return key;
}

function normalizeRows(rows) {
  // Long 형태(metric/value) 자동 pivot
  const hasMetric = rows.length && Object.keys(rows[0]).some((k) => norm(k) === "METRIC");
  const hasValue = rows.length && Object.keys(rows[0]).some((k) => norm(k) === "VALUE");
  if (hasMetric && hasValue) {
    const metaKeys = Object.keys(rows[0]).filter((k) => !["metric", "value"].includes(norm(k).toLowerCase()));
    const map = new Map();
    rows.forEach((r) => {
      const obj = {};
      for (const mk of metaKeys) obj[mapHeader(mk)] = r[mk];
      const key = metaKeys.map((mk) => `${mapHeader(mk)}::${r[mk]}`).join("|");
      const cur = map.get(key) || obj;
      const metricKey = Object.keys(r).find((k) => norm(k) === "METRIC");
      const valueKey = Object.keys(r).find((k) => norm(k) === "VALUE");
      const m = String(r[metricKey] || "").toUpperCase().replace(/[\s_-]+/g, "");
      const v = r[valueKey];
      if (/^PO\d+$/i.test(m)) cur[`PO_${poIndex(m)}`] = toNumber(v);
      if (/^TPO\d+$/i.test(m)) cur[`TPO_${tpoIndex(m)}`] = toNumber(v);
      map.set(key, cur);
    });
    return Array.from(map.values());
  }

  return rows.map((row) => {
    const mapped = {};
    Object.entries(row).forEach(([k, v]) => {
      mapped[mapHeader(k)] = v;
    });
    return mapped;
  });
}

// 파일명에서 전공 라벨 추정
function inferDeptFromFilename(name = "") {
  const n = name.toLowerCase();
  if (/(^|[_-])ce([_-]|\.|$)|computer|컴퓨터|전산/.test(n)) return "컴퓨터공학전공";
  if (/mediadesign|md_|design|디자인/.test(n)) return "미디어디자인공학전공";
  // ✅ EE/전력응용시스템 패턴 인식 → 새 표준 라벨
  if (/(^|[_-])ee([_-]|\.|$)|energy|electrical|power|전력응용시스템|전력|에너지|전기/.test(n))
    return "전력응용시스템공학";
  return "단일전공";
}


// 결과 rows에 전공 주입/보정
function ensureDept(rows, filename) {
  if (!rows.length) return rows;
  const keysUnion = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => keysUnion.add(k)));
  const hasDeptKey = Array.from(keysUnion).some((k) => norm(k) === "DEPT");

  const label = inferDeptFromFilename(filename);
  const filled = rows.map((r) => {
    const v = r.dept ?? r["학과"] ?? r["전공"] ?? r["DEPARTMENT"] ?? r["MAJOR"];
    if (!hasDeptKey || v === undefined || v === null || String(v).trim() === "") {
      return { ...r, dept: label };
    }
    // ✅ (v3.4) 교수님 수정 내역 반영 (정확한 명칭으로 통일)
 const deptStr = String(v).trim();
const d = deptStr.toLowerCase();
if (/(^|[^a-z])ee([^a-z]|$)|energy|electrical|power|전력응용시스템|전력|에너지|전기/.test(d))
  return { ...r, dept: "전력응용시스템공학" };
return { ...r, dept: deptStr };

  });

function canonMajor(raw = "") {
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  if (/(^|[_\s.-])ee([_\s.-]|$)|energy|electrical|power|전력응용시스템|전력|에너지|전기/.test(s))
    return "전력응용시스템공학";
  if (/mediadesign|design|미디어/.test(s)) return "미디어디자인공학전공";
  if (/(^|[_\s.-])ce([_\s.-]|$)|computer|컴퓨터|전산/.test(s)) return "컴퓨터공학전공";
  return raw.trim();
}
// inferDeptFromFilename / ensureDept 양쪽에서 canonMajor(...) 사용

  
  const empties = filled.filter((r) => !r.dept || String(r.dept).trim() === "").length;
  if (empties / filled.length >= 0.7) return filled.map((r) => ({ ...r, dept: label }));
  return filled;
}

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    const PapaMod = await import("papaparse");
    const Papa = PapaMod.default ?? PapaMod;
    const text = await file.text();
    const { data } = (Papa.parse ? Papa : Papa.default).parse(text, { header: true, skipEmptyLines: true });
    return normalizeRows(data);
  }
  if (["xlsx", "xls"].includes(ext)) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return normalizeRows(json);
  }
  throw new Error("지원하지 않는 파일 형식입니다. CSV 또는 XLSX를 사용하세요.");
}

// ------------------------ 집계 ---------------------------------------------
function extractMetrics(rows) {
  const cols = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => cols.add(k)));
  const poCols = Array.from(cols)
    .filter((c) => /^PO_\d+$/.test(c) || isPO(c))
    .map((c) => (String(c).startsWith("PO_") ? c : `PO_${poIndex(c)}`))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
  const tpoCols = Array.from(cols)
    .filter((c) => /^TPO_\d+$/.test(c) || isTPO(c))
    .map((c) => (String(c).startsWith("TPO_") ? c : `TPO_${tpoIndex(c)}`))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
  return { poCols, tpoCols };
}

function unique(values) {
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "")));
}

function semestersFromRows(rows) {
  return unique(rows.map((r) => r.semester ?? r.SEMESTER ?? r.TERM ?? r.SNAPSHOT ?? r["스냅샷"] ?? r["학기"]))
    .filter((s) => s !== undefined && s !== null && String(s).trim() !== "")
    .sort(compareSemester);
}

function compareSemester(a, b) {
  const [ay, at] = String(a).split(/[-_. ]/);
  const [by, bt] = String(b).split(/[-_. ]/);
  const ya = Number(ay) || 0; const yb = Number(by) || 0;
  const ta = Number(at) || 0; const tb = Number(bt) || 0;
  if (ya !== yb) return ya - yb;
  return ta - tb;
}

function aggregateByDept(rows, metricCols, deptKey, semesterFilter) {
  const depts = unique(rows.map((r) => r[deptKey]));
  const selectedRows = semesterFilter ? rows.filter((r) => String(r.semester ?? r.SEMESTER ?? "") === semesterFilter) : rows;
  return metricCols.map((col) => {
    const entry = { metric: col.replace(/_/g, "") };
    depts.forEach((d) => {
      const vals = selectedRows
        .filter((r) => r[deptKey] === d)
        .map((r) => toNumber(r[col]))
        .filter((v) => v !== null);
      entry[d] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return entry;
  });
}

// (사용 중단)
// function makeRadarData(rows, metricCols, dept, semesterFilter) {
//   const selectedRows = rows.filter((r) => (!semesterFilter || String(r.semester ?? r.SEMESTER ?? "") === semesterFilter) && r.dept === dept);
//   if (!selectedRows.length) return [];
//   const means = {};
//   metricCols.forEach((m) => {
//     const vals = selectedRows.map((r) => toNumber(r[m])).filter((v) => v !== null);
//     means[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
//   });
//   return metricCols.map((m) => ({ axis: m.replace(/_/g, ""), value: means[m] ?? 0 }));
// }

function aggregateOverTimeByDept(rows, metricCols, deptKey, selectedDepts) {
  const semesters = semestersFromRows(rows);
  return semesters.map((sem) => {
    const obj = { semester: sem };
    selectedDepts.forEach((d) => {
      const rsem = rows.filter((r) => (r[deptKey] === d) && (String(r.semester ?? r.SEMESTER ?? "") === sem));
      const vals = [];
      rsem.forEach((r) => metricCols.forEach((m) => { const v = toNumber(r[m]); if (v !== null) vals.push(v); }));
      obj[d] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return obj;
  });
}

function aggregateOverTimeByStudent(rows, metricCols, selectedStudents) {
  const semesters = semestersFromRows(rows);
  return semesters.map((sem) => {
    const obj = { semester: sem };
    selectedStudents.forEach((sid) => {
      const rsem = rows.filter((r) => (String(r.studentId ?? r["학번"] ?? r.ID) === String(sid)) && (String(r.semester ?? r.SEMESTER ?? "") === sem));
      const vals = [];
      rsem.forEach((r) => metricCols.forEach((m) => { const v = toNumber(r[m]); if (v !== null) vals.push(v); }));
      obj[sid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return obj;
  });
}

// GPA 인덱스
function buildStudentGPAIndex(gradeRows) {
  if (!gradeRows.length) return new Map();
  const gpaKey = Object.keys(gradeRows[0]).find((k) => HEADER_ALIASES.gpa.map(norm).includes(norm(k)));
  const idKey = Object.keys(gradeRows[0]).find((k) => HEADER_ALIASES.studentId.map(norm).includes(norm(k))) || "studentId";
  const idx = new Map(); // sid -> [gpa...]
  gradeRows.forEach((r) => {
    const sid = String(r[idKey] ?? r.studentId ?? r["학번"] ?? "").trim();
    const g = toNumber(r[gpaKey]);
    if (!sid) return;
    if (!idx.has(sid)) idx.set(sid, []);
    if (g !== null) idx.get(sid).push(g);
  });
  const out = new Map();
  idx.forEach((arr, sid) => {
    out.set(sid, arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  });
  return out;
}

function bucketFromGPA(g) {
  if (g === null || g === undefined) return "미확인";
  if (g < 3) return "2점대 이하"; // ✅ 2점대 이하(0~2.99 포함)
  if (g < 4) return "3점대";
  return "4점대+";
}

// ------------------------ 색상 ---------------------------------------------
const PALETTE = [
  "#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#84CC16", "#F472B6",
  "#F97316", "#22C55E", "#14B8A6", "#3B82F6", "#A855F7", "#E11D48", "#65A30D",
];
const colorMap = new Map();
const colorFor = (key) => {
  if (!colorMap.has(key)) colorMap.set(key, PALETTE[colorMap.size % PALETTE.length]);
  return colorMap.get(key);
};

// ------------------------ 메인 컴포넌트 ------------------------------------
export default function TPODashboard() {
  // ---------- Cloud (Vercel Blob) ----------
  const BLOB_TOKEN = import.meta.env.VITE_BLOB_READ_WRITE_TOKEN || "";
  const [cloudResults, setCloudResults] = useState([]); // [{name,url}]
  const [cloudGrades, setCloudGrades]   = useState([]); // [{name,url}]
  const [shareURL, setShareURL] = useState("");
  const [manifestURL, setManifestURL] = useState("");

  function makeId(len=8){
    const chars="abcdefghijklmnopqrstuvwxyz0123456789";
    let s=""; for (let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)];
    return s;
  }

  async function uploadToBlob(file, folder="files"){
    if (!BLOB_TOKEN) return null;
    try{
      const pathname = `${folder}/${Date.now()}_${file.name}`;
      const res = await put(pathname, file, { access: "public", token: BLOB_TOKEN });
      return { name: file.name, url: res.url };
    }catch(e){
      console.error("Blob upload failed:", e);
      return null;
    }
  }

  async function createShareLink(){
    if (!BLOB_TOKEN){ alert("환경변수 VITE_BLOB_READ_WRITE_TOKEN이 설정되어 있어야 공유 링크를 만들 수 있습니다."); return; }
    // ✅ (v3.4) 코드 수정본에 맞게 수정 (cloudResults.length===0 && cloudGrades.length===0){ alert("먼저 파일을 업로드하세요."); return; }
    if (resultFiles.length === 0 && gradeFiles.length === 0) {
      alert("먼저 파일을 업로드하세요.");
      return;
    }
    if (cloudResults.length === 0 && cloudGrades.length === 0) {
      alert(
        "클라우드 업로드에 실패했습니다. Vercel Blob 토큰 설정(권한 등)을 확인한 후, 페이지를 새로고침하여 파일을 다시 업로드해주세요."
      );
      return;
    }

    const manifest = { version: 1, createdAt: new Date().toISOString(), results: cloudResults, grades: cloudGrades };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const fname = `manifests/${makeId()}_manifest.json`;
    const res = await put(fname, blob, { access: "public", token: BLOB_TOKEN });
    setManifestURL(res.url);
    const link = `${window.location.origin}/?manifest=${encodeURIComponent(res.url)}`;
    setShareURL(link);
    try{
      await navigator.clipboard.writeText(link);
    }catch(_){}
  }

  async function parseRemote(url){
    const u = url.toLowerCase();
    if (u.endsWith(".csv")){
      const text = await fetch(url).then(r=>r.text());
      const PapaMod = await import("papaparse");
      const Papa = PapaMod.default ?? PapaMod;
      const { data } = (Papa.parse ? Papa : Papa.default).parse(text, { header: true, skipEmptyLines: true });
      return normalizeRows(data);
    } else if (u.endsWith(".xlsx") || u.endsWith(".xls")){
      const buf = await fetch(url).then(r=>r.arrayBuffer());
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      return normalizeRows(json);
    } else if (u.endsWith(".json")){
      const json = await fetch(url).then(r=>r.json());
      return json;
    } else {
      throw new Error("지원하지 않는 원격 파일 형식입니다.");
    }
  }

  // 업로드 파일 관리(여러 개)
  const [resultFiles, setResultFiles] = useState([]); // [{name, rows}]
  const [gradeFiles, setGradeFiles] = useState([]);   // [{name, rows}]

  const resultRows = useMemo(() => resultFiles.flatMap((f) => f.rows || []), [resultFiles]);
  const gradeRows  = useMemo(() => gradeFiles.flatMap((f) => f.rows || []), [gradeFiles]);

  const [error, setError] = useState("");
  const [semester, setSemester] = useState(""); // 칩 필터
  const [tabScope, setTabScope] = useState("DEPT"); // "DEPT" | "STUDENT"
  const [deptSelection, setDeptSelection] = useState([]);
  const [studentSelection, setStudentSelection] = useState([]);

  const { poCols, tpoCols } = useMemo(() => extractMetrics(resultRows), [resultRows]);

  // deptKey 탐지: 전체 레코드 키 합집합 기준
  const deptKey = useMemo(() => {
    const union = new Set();
    resultRows.forEach((r) => Object.keys(r).forEach((k) => union.add(k)));
    const cols = Array.from(union);
    const candidates = ["dept", "DEPARTMENT", "전공", "학과", "major", "MAJOR", "전공명", "학부"];
    const found = candidates.find((c) => cols.some((k) => norm(k) === norm(c)));
    return found || "dept";
  }, [resultRows]);

  const allDepts = useMemo(() => unique(resultRows.map((r) => r[deptKey])), [resultRows, deptKey]);
  const allSemesters = useMemo(() => semestersFromRows(resultRows), [resultRows]);
  const allStudents = useMemo(() => unique(resultRows.map((r) => String(r.studentId ?? r["학번"] ?? r.ID))), [resultRows]);

  // 학생 필터용 파생지표
  const gpaIndex = useMemo(() => buildStudentGPAIndex(gradeRows), [gradeRows]);
  const studentYearOptions = useMemo(() => unique(allStudents.map((sid) => String(sid).slice(0, 4)).filter((y) => /^\d{4}$/.test(y))), [allStudents]);

  // 기본 전공 자동 선택
  useEffect(() => {
    if (allDepts.length && deptSelection.length === 0) {
      setDeptSelection(allDepts.slice(0, Math.min(3, allDepts.length)));
    }
  }, [allDepts]);

  
  // URL의 ?manifest= 로 클라우드 데이터를 자동 로드
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const manifest = params.get("manifest");
    (async () => {
      if (manifest){
        try{
          const man = await parseRemote(manifest);
          setManifestURL(manifest);
          // results
          if (Array.isArray(man.results)){
            const parsedResults = await Promise.all(man.results.map(async (f)=>{
              const rows = await parseRemote(f.url);
              return { name: f.name, rows: ensureDept(rows, f.name) };
            }));
            setResultFiles(parsedResults);
            setCloudResults(man.results);
          }
          // grades
          if (Array.isArray(man.grades)){
            const parsedGrades = await Promise.all(man.grades.map(async (f)=>{
              const rows = await parseRemote(f.url);
              return { name: f.name, rows };
            }));
            setGradeFiles(parsedGrades);
            setCloudGrades(man.grades);
          }
        }catch(e){
          console.error(e);
          setError("공유 데이터를 불러오지 못했습니다. 링크가 올바른지 확인해 주세요.");
        }
      }
    })();
  }, []);

  // ---------------- 집계 데이터 ----------------
  const deptAggTPO = useMemo(() => aggregateByDept(resultRows, tpoCols, deptKey, semester), [resultRows, tpoCols, deptKey, semester]);
  const deptAggPO  = useMemo(() => aggregateByDept(resultRows, poCols,  deptKey, semester), [resultRows, poCols,  deptKey, semester]);

  // ✅ 요청 #1: 레이더 차트 수정 (모든 선택 전공 반영)
  const radarDataTPO = useMemo(() => {
    const selectedDepts = deptSelection.length ? deptSelection : allDepts;
    if (!selectedDepts.length || !tpoCols.length) return [];
    
    const deptMeans = new Map(); // dept -> { TPO1: mean, TPO2: mean, ... }
    selectedDepts.forEach(d => {
      const rows = resultRows.filter(r => r[deptKey] === d && (!semester || String(r.semester ?? r.SEMESTER ?? "") === semester));
      const means = {};
      tpoCols.forEach(mKey => {
        const vals = rows.map(r => toNumber(r[mKey])).filter(v => v !== null);
        means[mKey.replace(/_/g, "")] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      deptMeans.set(d, means);
    });
  
    // Pivot: [{ axis: "TPO1", deptA: val, deptB: val }, ...]
    return tpoCols.map(mKey => {
      const axis = mKey.replace(/_/g, "");
      const entry = { axis };
      selectedDepts.forEach(d => {
        entry[d] = deptMeans.get(d)?.[axis] ?? 0;
      });
      return entry;
    });
  }, [resultRows, tpoCols, deptSelection, allDepts, deptKey, semester]);
  
  const radarDataPO = useMemo(() => {
    const selectedDepts = deptSelection.length ? deptSelection : allDepts;
    if (!selectedDepts.length || !poCols.length) return [];
    
    const deptMeans = new Map(); // dept -> { PO1: mean, PO2: mean, ... }
    selectedDepts.forEach(d => {
      const rows = resultRows.filter(r => r[deptKey] === d && (!semester || String(r.semester ?? r.SEMESTER ?? "") === semester));
      const means = {};
      poCols.forEach(mKey => {
        const vals = rows.map(r => toNumber(r[mKey])).filter(v => v !== null);
        means[mKey.replace(/_/g, "")] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      deptMeans.set(d, means);
    });
  
    // Pivot: [{ axis: "PO1", deptA: val, deptB: val }, ...]
    return poCols.map(mKey => {
      const axis = mKey.replace(/_/g, "");
      const entry = { axis };
      selectedDepts.forEach(d => {
        entry[d] = deptMeans.get(d)?.[axis] ?? 0;
      });
      return entry;
    });
  }, [resultRows, poCols, deptSelection, allDepts, deptKey, semester]);


  const deptGrowthTPO = useMemo(() => aggregateOverTimeByDept(resultRows.map(r => ({...r, dept: r[deptKey]})), tpoCols, "dept", deptSelection.length ? deptSelection : allDepts), [resultRows, tpoCols, deptSelection, deptKey, allDepts]);
  const deptGrowthPO  = useMemo(() => aggregateOverTimeByDept(resultRows.map(r => ({...r, dept: r[deptKey]})), poCols,  "dept", deptSelection.length ? deptSelection : allDepts), [resultRows, poCols,  deptSelection, deptKey, allDepts]);

  // 학생별 집계(선택 학기)
  const latestSemester = allSemesters[allSemesters.length - 1] || "";
  const activeSemester = semester || latestSemester;

  // 학생 필터 상태
  const [studentDeptFilter, setStudentDeptFilter] = useState([]); // 전공 필터(다중)
  const [gpaBuckets, setGpaBuckets] = useState([]); // ["2점대 이하","3점대","4점대+"]
  const [yearFilter, setYearFilter] = useState([]); // 입학연도(다중)

  const filteredStudentIds = useMemo(() => {
    let ids = allStudents;
    if (studentDeptFilter.length) {
      const allowed = new Set(studentDeptFilter);
      ids = ids.filter((sid) => {
        const rows = resultRows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        return rows.some((r) => allowed.has(String(r[deptKey])));
      });
    }
    if (gpaBuckets.length) {
      ids = ids.filter((sid) => gpaBuckets.includes(bucketFromGPA(gpaIndex.get(String(sid)))));
    }
    if (yearFilter.length) {
      const years = new Set(yearFilter);
      ids = ids.filter((sid) => years.has(String(sid).slice(0, 4)));
    }
    return ids;
  }, [allStudents, resultRows, deptKey, studentDeptFilter, gpaBuckets, yearFilter, gpaIndex]);

  // 학생 막대(TPO/PO)
  const studentBarTPO = useMemo(() => {
    // ✅ 요청 #3 확인: studentSelection (선택된 학생) 기준으로 필터링해야 함
    const targetIds = studentSelection.length ? studentSelection : filteredStudentIds;
    if (!targetIds.length) return [];
    
    const rows = resultRows.filter((r) => 
      String(r.semester ?? r.SEMESTER ?? "") === activeSemester && 
      targetIds.includes(String(r.studentId ?? r["학번"] ?? r.ID))
    );
    
    if (!rows.length) return [];
    
    return tpoCols.map((m) => {
      const obj = { metric: m.replace(/_/g, "") };
      targetIds.forEach((sid) => { // ✅ targetIds (선택된 학생들) 기준으로 루프
        const rr = rows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        const vals = rr.map((r) => toNumber(r[m])).filter((v) => v !== null);
        obj[sid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return obj;
    });
  }, [resultRows, tpoCols, filteredStudentIds, studentSelection, activeSemester]); // ✅ studentSelection 의존성 추가
  
  const studentBarPO = useMemo(() => {
    // ✅ 요청 #3 확인: studentSelection (선택된 학생) 기준으로 필터링
    const targetIds = studentSelection.length ? studentSelection : filteredStudentIds;
    if (!targetIds.length) return [];

    const rows = resultRows.filter((r) => 
      String(r.semester ?? r.SEMESTER ?? "") === activeSemester && 
      targetIds.includes(String(r.studentId ?? r["학번"] ?? r.ID))
    );
    
    if (!rows.length) return [];
    
    return poCols.map((m) => {
      const obj = { metric: m.replace(/_/g, "") };
      targetIds.forEach((sid) => { // ✅ targetIds (선택된 학생들) 기준으로 루프
        const rr = rows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        const vals = rr.map((r) => toNumber(r[m])).filter((v) => v !== null);
        obj[sid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return obj;
    });
  }, [resultRows, poCols, filteredStudentIds, studentSelection, activeSemester]); // ✅ studentSelection 의존성 추가

  // 학생 성장(TPO/PO)
  // ✅ 요청 #3 확인: studentSelection (선택된 학생) 기준으로 필터링
  const studentGrowthTPO = useMemo(() => aggregateOverTimeByStudent(resultRows, tpoCols, studentSelection), [resultRows, tpoCols, studentSelection]);
  const studentGrowthPO  = useMemo(() => aggregateOverTimeByStudent(resultRows, poCols,  studentSelection), [resultRows, poCols,  studentSelection]);

  // ---------------- 파일 업로드/삭제 ----------------
  async function onUploadResults(e) {
    setError("");
    try {
      const files = Array.from(e.target.files || []);
      const parsed = await Promise.all(files.map(async (file) => {
        const rows = await parseFile(file);
        const ensured = ensureDept(rows, file.name);
        const normalized = ensured.map((r) => ({
          ...r,
          studentId: r.studentId ?? r["학번"] ?? r["STUDENT ID"] ?? r["ID"],
          semester: r.semester ?? r["학기"] ?? r["SEMESTER"] ?? r["SNAPSHOT"] ?? r["TERM"],
        }));
        return { name: file.name, rows: normalized };
      }));
      setResultFiles((prev) => prev.concat(parsed));
      // Cloud upload (optional)
      if (BLOB_TOKEN){
        const uploads = await Promise.all(files.map(async (file)=> await uploadToBlob(file, 'results')));
        const ok = uploads.filter(Boolean);
        if (ok.length) setCloudResults((prev)=> prev.concat(ok));
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function onUploadGrades(e) {
    setError("");
    try {
      const files = Array.from(e.target.files || []);
      const parsed = await Promise.all(files.map(async (file) => ({ name: file.name, rows: await parseFile(file) })));
      setGradeFiles((prev) => prev.concat(parsed));
      if (BLOB_TOKEN){
        const uploads = await Promise.all(files.map(async (file)=> await uploadToBlob(file, 'grades')));
        const ok = uploads.filter(Boolean);
        if (ok.length) setCloudGrades((prev)=> prev.concat(ok));
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  function removeResultFile(name) { setResultFiles((prev) => prev.filter((f) => f.name !== name)); }
  function removeGradeFile(name) { setGradeFiles((prev) => prev.filter((f) => f.name !== name)); }

  // 공통 Tooltip 포맷
  const tooltipFmt = (value, name) => [fmt2(value), name];

  // ✅ 요청 #4: 빈 차트 메시지 컴포넌트
  const EmptyChartMessage = () => (
    <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-gray-500">
      현재 해당 학생의 전공역량 데이터가 충분하지 않아 출력되지 않습니다
    </div>
  );

  // ---------------- UI ----------------
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-7xl p-6">
        <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">전공역량 대시보드 (TPO & PO 동시 비교)</h1>
            <p className="text-sm text-gray-500">전공/학생 단위 비교, 시점별 성장, 다중 필터(전공·성적·연도)를 제공합니다.</p>
          </div>
          <div className="flex rounded-full border overflow-hidden">
            <button onClick={() => setTabScope('DEPT')}    className={`px-3 py-1 ${tabScope==='DEPT'   ?'bg-gray-900 text-white':'bg-white'}`}>전공별</button>
            <button onClick={() => setTabScope('STUDENT')} className={`px-3 py-1 ${tabScope==='STUDENT'?'bg-gray-900 text-white':'bg-white'}`}>학생별</button>
          </div>
        </header>

        {/* 업로드 & 파일관리 */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">① 결과 파일 업로드 (TPO/PO 혼합 허용)</h2>
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUploadResults} className="block w-full rounded-lg border p-2" />
            <p className="mt-2 text-xs text-gray-500">학과/전공, (학기), PO*, TPO* 열을 자동 인식합니다. 전공 열이 없으면 파일명으로 자동 할당됩니다.</p>
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-medium mb-1">업로드된 결과 파일</div>
              {resultFiles.length === 0 ? (
                <div className="text-xs text-gray-500">(없음)</div>
              ) : (
                <ul className="text-sm divide-y max-h-24 overflow-y-auto">{/* ✅ 3줄 높이 고정 & 스크롤 */}
                  {resultFiles.map((f) => (
                    <li key={f.name} className="flex items-center justify-between py-1">
                      <span className="truncate mr-2">{f.name}</span>
                      <button onClick={() => removeResultFile(f.name)} className="text-xs rounded border px-2 py-1">삭제</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">② 성적 데이터 업로드 (선택)</h2>
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUploadGrades} className="block w-full rounded-lg border p-2" />
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-medium mb-1">업로드된 성적 파일</div>
              {gradeFiles.length === 0 ? (
                <div className="text-xs text-gray-500">(없음)</div>
              ) : (
                <ul className="text-sm divide-y max-h-24 overflow-y-auto">{/* ✅ 3줄 높이 고정 & 스크롤 */}
                  {gradeFiles.map((f) => (
                    <li key={f.name} className="flex items-center justify-between py-1">
                      <span className="truncate mr-2">{f.name}</span>
                      <button onClick={() => removeGradeFile(f.name)} className="text-xs rounded border px-2 py-1">삭제</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">③ 클라우드 공유(선택)</h2>
            <div className="text-sm text-gray-600">
              <div className="mb-2">현재 업로드를 Vercel Blob에 저장하여, <b>공유 링크</b>로 어디서나 열 수 있습니다.</div>
              <div className="mb-2">환경변수 <code>VITE_BLOB_READ_WRITE_TOKEN</code> 이 설정되어 있어야 업로드가 됩니다.</div>
              <button
                className="rounded border px-3 py-1 text-sm"
                onClick={createShareLink}
              >
                공유 링크 만들기
              </button>
              {shareURL && (
                <div className="mt-2 text-xs break-all">
                  공유 링크: <a className="text-blue-600 underline" href={shareURL} target="_blank" rel="noreferrer">{shareURL}</a>
                  <div className="text-gray-500">(클립보드로도 복사되었습니다)</div>
                </div>
              )}
              {manifestURL && (
                <div className="mt-1 text-xs break-all text-gray-500">
                  manifest: {manifestURL}
                </div>
              )}
            </div>
          </div>

        </section>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>
        )}

        {/* 데이터 상태 */}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">결과 레코드</div>
            <div className="text-2xl font-bold">{resultRows.length.toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">PO 열 {poCols.length}개 · TPO 열 {tpoCols.length}개 감지</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">성적 레코드</div>
            <div className="text-2xl font-bold">{gradeRows.length.toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">(GPA 필터 사용 가능)</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">전공 수</div>
            <div className="text-2xl font-bold">{allDepts.length}</div>
            <div className="mt-2 text-xs text-gray-500">선택: {deptSelection.join(" · ") || "미선택"}</div>
          </div>
        </section>

        {/* 필터: 학기 칩 */}
        <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium mr-2">학기</div>
            <button onClick={() => setSemester("")} className={`px-3 py-1 rounded-full border ${semester===''? 'bg-gray-900 text-white' : 'bg-white'}`}>전체</button>
            {allSemesters.map((s) => (
              <button key={String(s)} onClick={() => setSemester(String(s))} className={`px-3 py-1 rounded-full border ${semester===String(s)? 'bg-gray-900 text-white' : 'bg-white'}`}>{String(s)}</button>
            ))}
          </div>
        </section>

        {/* 전공별 / 학생별 영역 */}
        {tabScope === 'DEPT' ? (
          (resultRows.length > 0 && (tpoCols.length > 0 || poCols.length > 0)) && (
            <section className="mt-6 space-y-6">
              {/* 전공 선택 */}
              <div className="rounded-2xl border bg-white p-4 shadow-sm flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium">전공 선택</label>
                <select
                  multiple
                  className="min-h-[44px] min-w-[260px] rounded-lg border p-2 text-sm"
                  value={deptSelection}
                  onChange={(e) => {
                    const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                    setDeptSelection(opts);
                  }}
                >
                  {allDepts.map((d) => (
                    <option key={String(d)} value={String(d)}>{String(d)}</option>
                  ))}
                </select>
                <button onClick={() => setDeptSelection(allDepts)} className="rounded-full border px-3 py-1 text-sm">전체 전공</button>
                <button onClick={() => setDeptSelection([])} className="rounded-full border px-3 py-1 text-sm">선택 해제</button>
              </div>

              {/* 막대 비교: TPO | PO */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">TPO 지표 비교 (선택 전공)</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <BarChart data={deptAggTPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                        <YAxis />
                        <Tooltip formatter={tooltipFmt} />
                        <Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (
                          <Bar key={d} dataKey={d} barSize={22} fill={colorFor(d)} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">PO 지표 비교 (선택 전공)</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <BarChart data={deptAggPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                        <YAxis />
                        <Tooltip formatter={tooltipFmt} />
                        <Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (
                          <Bar key={d} dataKey={d} barSize={22} fill={colorFor(d)} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* ✅ 요청 #1: 레이더 비교 수정 */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">TPO 레이더 그래프</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <RadarChart data={radarDataTPO}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="axis" />
                        <PolarRadiusAxis />
                        {(deptSelection.length ? deptSelection : allDepts).map((d) => (
                          <Radar key={d} name={d} dataKey={d} stroke={colorFor(d)} fillOpacity={0} strokeWidth={2} />
                        ))}
                        <Legend />
                        <Tooltip formatter={tooltipFmt} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">PO 레이더 그래프</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <RadarChart data={radarDataPO}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="axis" />
                        <PolarRadiusAxis />
                        {(deptSelection.length ? deptSelection : allDepts).map((d) => (
                          <Radar key={d} name={d} dataKey={d} stroke={colorFor(d)} fillOpacity={0} strokeWidth={2} />
                        ))}
                        <Legend />
                        <Tooltip formatter={tooltipFmt} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* ✅ 요청 #2: 성장 비교 Y축 수정 */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">시점별 성장 (TPO 평균)</h3>
                  <div className="h-[360px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={deptGrowthTPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="semester" />
                        <YAxis domain={[25, 'auto']} />
                        <Tooltip formatter={tooltipFmt} />
                        <Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (
                          <Line key={d} type="monotone" dataKey={d} stroke={colorFor(d)} dot={true} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">시점별 성장 (PO 평균)</h3>
                  <div className="h-[360px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={deptGrowthPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="semester" />
                        <YAxis domain={[25, 'auto']} />
                        <Tooltip formatter={tooltipFmt} />
                        <Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (
                          <Line key={d} type="monotone" dataKey={d} stroke={colorFor(d)} dot={true} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>
          )
        ) : (
          // STUDENT SCOPE
          (resultRows.length > 0 && (tpoCols.length > 0 || poCols.length > 0)) && (
            <section className="mt-6 space-y-6">
              {/* 학생 필터 UI */}
              <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm font-medium">전공 필터</label>
                  <select
                    multiple
                    className="min-h-[44px] min-w-[260px] rounded-lg border p-2 text-sm"
                    value={studentDeptFilter}
                    onChange={(e) => {
                      const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                      setStudentDeptFilter(opts);
                    }}
                  >
                    {allDepts.map((d) => (
                      <option key={String(d)} value={String(d)}>{String(d)}</option>
                    ))}
                  </select>
                  <button onClick={() => setStudentDeptFilter(allDepts)} className="rounded-full border px-3 py-1 text-sm">전체 전공</button>
                  <button onClick={() => setStudentDeptFilter([])} className="rounded-full border px-3 py-1 text-sm">전체(해제)</button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">성적 구간</span>
                  {(["2점대 이하","3점대","4점대+"]).map((b) => (
                    <button key={b} onClick={() => setGpaBuckets((prev) => prev.includes(b) ? prev.filter(x=>x!==b) : prev.concat(b))} className={`px-3 py-1 rounded-full border ${gpaBuckets.includes(b)?'bg-gray-900 text-white':'bg-white'}`}>{b}</button>
                  ))}
                  <button onClick={() => setGpaBuckets([])} className="rounded-full border px-3 py-1 text-sm">전체</button>
                  <span className="text-xs text-gray-500 ml-2">(성적 데이터가 없으면 미적용)</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">학번 연도</span>
                  <button onClick={() => setYearFilter([])} className="rounded-full border px-3 py-1 text-sm">전체</button>
                  {studentYearOptions.map((y) => (
                    <button key={y} onClick={() => setYearFilter((prev) => prev.includes(y) ? prev.filter(x=>x!==y) : prev.concat(y))} className={`px-3 py-1 rounded-full border ${yearFilter.includes(y)?'bg-gray-900 text-white':'bg-white'}`}>{y}</button>
                  ))}
                </div>

                <div className="flex flex-wrap items-start gap-3">
                  <div>
                    <div className="text-sm font-medium mb-1">학번 선택(다중)</div>
                    <select
                      multiple
                      size={8}
                      className="min-w-[260px] rounded-lg border p-2 text-sm"
                      value={studentSelection}
                      onChange={(e) => {
                        const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
                        setStudentSelection(opts);
                      }}
                    >
                      {filteredStudentIds.map((sid) => (
                        <option key={String(sid)} value={String(sid)}>
                          {String(sid)} {gpaIndex.has(String(sid)) ? ` (GPA ${fmt2(gpaIndex.get(String(sid)))})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-gray-500 max-w-sm">
                    Tip: 전공·성적·연도 필터를 조합한 뒤 학번을 선택하면 TPO·PO 막대와 성장 그래프가 동시에 표시됩니다. 
                    <br />
                    <b>(Ctrl 또는 Cmd 키를 누른 채 클릭하면 여러 명을 선택할 수 있습니다.)</b>
                  </div>
                </div>
              </div>

              {/* ✅ 요청 #4: 학생 막대 비교 수정 (빈 차트 메시지) */}
              {studentSelection.length >= 1 && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 TPO 지표 (학기: {activeSemester || '전체'})</h3>
                    <div className="h-[380px] w-full">
                      {studentBarTPO.length === 0 ? (
                        <EmptyChartMessage />
                      ) : (
                        <ResponsiveContainer>
                          <BarChart data={studentBarTPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                            <YAxis />
                            <Tooltip formatter={tooltipFmt} />
                            <Legend />
                            {studentSelection.map((sid) => (
                              <Bar key={sid} dataKey={sid} barSize={20} fill={colorFor(sid)} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 PO 지표 (학기: {activeSemester || '전체'})</h3>
                    <div className="h-[380px] w-full">
                      {studentBarPO.length === 0 ? (
                        <EmptyChartMessage />
                      ) : (
                        <ResponsiveContainer>
                          <BarChart data={studentBarPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                            <YAxis />
                            <Tooltip formatter={tooltipFmt} />
                            <Legend />
                            {studentSelection.map((sid) => (
                              <Bar key={sid} dataKey={sid} barSize={20} fill={colorFor(sid)} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ✅ 요청 #4: 학생 성장 비교 수정 (빈 차트 메시지) */}
              {studentSelection.length >= 1 && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 시점별 성장 (TPO 평균)</h3>
                    <div className="h-[360px] w-full">
                      {studentGrowthTPO.length === 0 ? (
                        <EmptyChartMessage />
                      ) : (
                        <ResponsiveContainer>
                          <LineChart data={studentGrowthTPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="semester" />
                            <YAxis />
                            <Tooltip formatter={tooltipFmt} />
                            <Legend />
                            {studentSelection.map((sid) => (
                              <Line key={sid} type="monotone" dataKey={sid} stroke={colorFor(sid)} dot={true} strokeWidth={2} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 시점별 성장 (PO 평균)</h3>
                    <div className="h-[360px] w-full">
                      {studentGrowthPO.length === 0 ? (
                        <EmptyChartMessage />
                      ) : (
                        <ResponsiveContainer>
                          <LineChart data={studentGrowthPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="semester" />
                            <YAxis />
                            <Tooltip formatter={tooltipFmt} />
                            <Legend />
                            {studentSelection.map((sid) => (
                              <Line key={sid} type="monotone" dataKey={sid} stroke={colorFor(sid)} dot={true} strokeWidth={2} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )
        )}

        {/* 도움말 */}
        <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold">사용 팁</h3>
          <ol className="list-decimal pl-5 text-sm text-gray-700">
            <li>모든 차트의 Tooltip 수치는 소수점 둘째자리로 표기됩니다.</li>
            <li>전공별/학생별에서 TPO와 PO를 좌우로 배치해 한눈에 비교할 수 있습니다.</li>
            <li>학생별 탭에서 전공·성적구간(2점대 이하/3점대/4점대+)·학번연도 필터를 조합해 보세요. 각 필터에 "전체" 버튼이 있습니다.</li>
            <li>전공별 탭의 "전체 전공"을 누르면 모든 전공 시리즈가 중복 표출됩니다.</li>
            <li>학생별 탭의 필터 목록에서 <b>Ctrl키(Cmd)를 누른 채 클릭</b>하면 여러 항목을 동시에 선택할 수 있습니다.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

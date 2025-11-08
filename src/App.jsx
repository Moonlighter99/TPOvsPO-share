// src/App.jsx — V3.6 (클라우드 공유 제거 + 축 고정 + 학번 부분검색)
import React, { useMemo, useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line,
} from "recharts";

/** 유틸 */
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
  // Long(metric/value) → Wide 자동 피벗
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
    Object.entries(row).forEach(([k, v]) => { mapped[mapHeader(k)] = v; });
    return mapped;
  });
}

/** 전공 표준화 */
function canonMajor(raw = "") {
  const s = String(raw).trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[∙•·]/g, "·")
    .toLowerCase();

  if (!s || /단일\s*전공/.test(s)) return "";
  if (/(^|[_\s.-])ce([_\s.-]|$)|computer|컴퓨터|전산/.test(s)) return "컴퓨터공학전공";
  if (/mediadesign|md_|design|미디어/.test(s)) return "미디어디자인공학전공";
  if (/(^|[_\s.-])ee([_\s.-]|$)|energy|electrical|power|전력응용시스템|전력|에너지|전기/.test(s))
    return "전력응용시스템공학";
  return "";
}

/** 파일명에서 전공 추정 */
function inferDeptFromFilename(name = "") {
  const n = String(name).toLowerCase();
  if (/(^|[_-])ce([_-]|\.|$)|computer|컴퓨터|전산/.test(n)) return "컴퓨터공학전공";
  if (/mediadesign|md_|design|디자인/.test(n)) return "미디어디자인공학전공";
  if (/(^|[_-])ee([_-]|\.|$)|energy|electrical|power|전력응용시스템|전력|에너지|전기/.test(n)) return "전력응용시스템공학";
  return "";
}

/** 전공 주입/보정 */
function ensureDept(rows, filename) {
  if (!rows.length) return rows;
  const inferred = inferDeptFromFilename(filename);
  return rows.map((r) => {
    const raw =
      r.dept ?? r["학과"] ?? r["전공"] ?? r["전공명"] ?? r["DEPARTMENT"] ?? r["MAJOR"] ?? r["학부"] ?? "";
    let dept = canonMajor(raw);
    if (!dept) dept = inferred;
    if (!dept) return { ...r, dept: "", __unknown_major__: true };
    return { ...r, dept };
  });
}

/** 원격/로컬 파일 파서 */
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

async function parseRemote(url){
  const u = url.toLowerCase();
  if (u.endsWith(".csv")){
    const text = await fetch(url, { cache: "no-store" }).then(r=>r.text());
    const PapaMod = await import("papaparse"); const Papa = PapaMod.default ?? PapaMod;
    const { data } = (Papa.parse ? Papa : Papa.default).parse(text, { header: true, skipEmptyLines: true });
    return normalizeRows(data);
  } else if (u.endsWith(".xlsx") || u.endsWith(".xls")){
    const buf = await fetch(url, { cache: "no-store" }).then(r=>r.arrayBuffer());
    const XLSX = await import("xlsx"); const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]]; const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return normalizeRows(json);
  } else if (u.endsWith(".json")){
    return fetch(url, { cache: "no-store" }).then(r=>r.json());
  }
  throw new Error("지원하지 않는 원격 파일 형식입니다.");
}

/** 메트릭 추출/집계 */
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
function buildStudentGPAIndex(gradeRows) {
  if (!gradeRows.length) return new Map();
  const gpaKey = Object.keys(gradeRows[0]).find((k) => HEADER_ALIASES.gpa.map(norm).includes(norm(k)));
  const idKey = Object.keys(gradeRows[0]).find((k) => HEADER_ALIASES.studentId.map(norm).includes(norm(k))) || "studentId";
  const idx = new Map();
  gradeRows.forEach((r) => {
    const sid = String(r[idKey] ?? r.studentId ?? r["학번"] ?? "").trim();
    const g = toNumber(r[gpaKey]);
    if (!sid) return;
    if (!idx.has(sid)) idx.set(sid, []);
    if (g !== null) idx.get(sid).push(g);
  });
  const out = new Map();
  idx.forEach((arr, sid) => { out.set(sid, arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null); });
  return out;
}
function bucketFromGPA(g) {
  if (g === null || g === undefined) return "미확인";
  if (g < 3) return "2점대 이하";
  if (g < 4) return "3점대";
  return "4점대+";
}

/** 색상 */
const PALETTE = ["#2563EB","#10B981","#F59E0B","#EF4444","#8B5CF6","#06B6D4","#84CC16","#F472B6","#F97316","#22C55E","#14B8A6","#3B82F6","#A855F7","#E11D48","#65A30D"];
const colorMap = new Map();
const colorFor = (key) => { if (!colorMap.has(key)) colorMap.set(key, PALETTE[colorMap.size % PALETTE.length]); return colorMap.get(key); };

/** 메인 */
export default function TPODashboard() {
  // 업로드 상태
  const [resultFiles, setResultFiles] = useState([]); // [{name, rows}]
  const [gradeFiles, setGradeFiles]   = useState([]); // [{name, rows}]
  const resultRows = useMemo(() => resultFiles.flatMap((f) => f.rows || []), [resultFiles]);
  const gradeRows  = useMemo(() => gradeFiles.flatMap((f) => f.rows || []), [gradeFiles]);

  const [error, setError] = useState("");
  const [semester, setSemester] = useState("");
  const [tabScope, setTabScope] = useState("DEPT");
  const [deptSelection, setDeptSelection] = useState([]);
  const [studentSelection, setStudentSelection] = useState([]);
  const [studentSearch, setStudentSearch] = useState(""); // 학번 부분검색

  const { poCols, tpoCols } = useMemo(() => extractMetrics(resultRows), [resultRows]);

  // deptKey
  const deptKey = useMemo(() => {
    const union = new Set(); resultRows.forEach((r) => Object.keys(r).forEach((k) => union.add(k)));
    const cols = Array.from(union);
    const candidates = ["dept","DEPARTMENT","전공","학과","major","MAJOR","전공명","학부"];
    const found = candidates.find((c) => cols.some((k) => norm(k) === norm(c)));
    return found || "dept";
  }, [resultRows]);

  // 전공 목록
  const allDepts = useMemo(() => {
    return unique(
      resultRows
        .map((r) => r[deptKey])
        .filter((m) => m && String(m).trim() !== "" && String(m).trim() !== "단일전공")
    );
  }, [resultRows, deptKey]);

  const allSemesters = useMemo(() => semestersFromRows(resultRows), [resultRows]);
  const allStudents = useMemo(() => unique(resultRows.map((r) => String(r.studentId ?? r["학번"] ?? r.ID))), [resultRows]);

  // GPA 인덱스/학생 필터 파생
  const gpaIndex = useMemo(() => buildStudentGPAIndex(gradeRows), [gradeRows]);
  const studentYearOptions = useMemo(() => unique(allStudents.map((sid) => String(sid).slice(0, 4)).filter((y) => /^\d{4}$/.test(y))), [allStudents]);

  useEffect(() => { if (allDepts.length && deptSelection.length === 0) setDeptSelection(allDepts.slice(0, Math.min(3, allDepts.length))); }, [allDepts]);

  // manifest 자동 로드
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const manifest = params.get("manifest");
    (async () => {
      if (manifest){
        try{
          const man = await parseRemote(manifest);
          if (Array.isArray(man.results)){
            const parsedResults = await Promise.all(man.results.map(async (f)=>{
              const rows = await parseRemote(f.url);
              const ensured = ensureDept(rows, f.name).map((r)=>({
                ...r,
                studentId: r.studentId ?? r["학번"] ?? r["STUDENT ID"] ?? r["ID"],
                semester:  r.semester  ?? r["학기"] ?? r["SEMESTER"] ?? r["SNAPSHOT"] ?? r["TERM"],
              }));
              return { name: f.name, rows: ensured };
            }));
            setResultFiles(parsedResults);
          }
          if (Array.isArray(man.grades)){
            const parsedGrades = await Promise.all(man.grades.map(async (f)=>({ name: f.name, rows: await parseRemote(f.url) })));
            setGradeFiles(parsedGrades);
          }
        }catch(e){
          console.error(e);
          setError("공유 데이터를 불러오지 못했습니다. 링크가 올바른지 확인해 주세요.");
        }
      }
    })();
  }, []);

  /** 집계 */
  const deptAggTPO = useMemo(() => aggregateByDept(resultRows, tpoCols, deptKey, semester), [resultRows, tpoCols, deptKey, semester]);
  const deptAggPO  = useMemo(() => aggregateByDept(resultRows, poCols,  deptKey, semester), [resultRows, poCols,  deptKey, semester]);

  const radarDataTPO = useMemo(() => {
    const selectedDepts = deptSelection.length ? deptSelection : allDepts;
    if (!selectedDepts.length || !tpoCols.length) return [];
    const deptMeans = new Map();
    selectedDepts.forEach(d => {
      const rows = resultRows.filter(r => r[deptKey] === d && (!semester || String(r.semester ?? r.SEMESTER ?? "") === semester));
      const means = {};
      tpoCols.forEach(mKey => {
        const vals = rows.map(r => toNumber(r[mKey])).filter(v => v !== null);
        means[mKey.replace(/_/g, "")] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      deptMeans.set(d, means);
    });
    return tpoCols.map(mKey => {
      const axis = mKey.replace(/_/g, "");
      const entry = { axis };
      selectedDepts.forEach(d => { entry[d] = deptMeans.get(d)?.[axis] ?? 0; });
      return entry;
    });
  }, [resultRows, tpoCols, deptSelection, allDepts, deptKey, semester]);

  const radarDataPO = useMemo(() => {
    const selectedDepts = deptSelection.length ? deptSelection : allDepts;
    if (!selectedDepts.length || !poCols.length) return [];
    const deptMeans = new Map();
    selectedDepts.forEach(d => {
      const rows = resultRows.filter(r => r[deptKey] === d && (!semester || String(r.semester ?? r.SEMESTER ?? "") === semester));
      const means = {};
      poCols.forEach(mKey => {
        const vals = rows.map(r => toNumber(r[mKey])).filter(v => v !== null);
        means[mKey.replace(/_/g, "")] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      deptMeans.set(d, means);
    });
    return poCols.map(mKey => {
      const axis = mKey.replace(/_/g, "");
      const entry = { axis };
      selectedDepts.forEach(d => { entry[d] = deptMeans.get(d)?.[axis] ?? 0; });
      return entry;
    });
  }, [resultRows, poCols, deptSelection, allDepts, deptKey, semester]);

  const deptGrowthTPO = useMemo(() => aggregateOverTimeByDept(resultRows.map(r => ({...r, dept: r[deptKey]})), tpoCols, "dept", deptSelection.length ? deptSelection : allDepts), [resultRows, tpoCols, deptSelection, deptKey, allDepts]);
  const deptGrowthPO  = useMemo(() => aggregateOverTimeByDept(resultRows.map(r => ({...r, dept: r[deptKey]})), poCols,  "dept", deptSelection.length ? deptSelection : allDepts), [resultRows, poCols,  deptSelection, deptKey, allDepts]);

  // 학생 영역
  const allStudentsIds = allStudents;
  const allSemestersList = allSemesters;
  const latestSemester = allSemestersList[allSemestersList.length - 1] || "";
  const activeSemester = semester || latestSemester;
  const [studentDeptFilter, setStudentDeptFilter] = useState([]);
  const [gpaBuckets, setGpaBuckets] = useState([]);
  const [yearFilter, setYearFilter] = useState([]);

  const filteredStudentIds = useMemo(() => {
    let ids = allStudentsIds;
    if (studentDeptFilter.length) {
      const allowed = new Set(studentDeptFilter);
      ids = ids.filter((sid) => {
        const rows = resultRows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        return rows.some((r) => allowed.has(String(r[deptKey])));
      });
    }
    if (gpaBuckets.length) ids = ids.filter((sid) => gpaBuckets.includes(bucketFromGPA(gpaIndex.get(String(sid)))));
    if (yearFilter.length) { const years = new Set(yearFilter); ids = ids.filter((sid) => years.has(String(sid).slice(0, 4))); }
    return ids;
  }, [allStudentsIds, resultRows, deptKey, studentDeptFilter, gpaBuckets, yearFilter, gpaIndex]);

  // 학번 부분검색 반영 목록
  const shownStudentIds = useMemo(() => {
    const q = studentSearch.trim();
    if (!q) return filteredStudentIds;
    return filteredStudentIds.filter((sid) => String(sid).includes(q));
  }, [filteredStudentIds, studentSearch]);

  const studentBarTPO = useMemo(() => {
    const targetIds = studentSelection.length ? studentSelection : filteredStudentIds;
    if (!targetIds.length) return [];
    const rows = resultRows.filter((r) => String(r.semester ?? r.SEMESTER ?? "") === activeSemester && targetIds.includes(String(r.studentId ?? r["학번"] ?? r.ID)));
    if (!rows.length) return [];
    return tpoCols.map((m) => {
      const obj = { metric: m.replace(/_/g, "") };
      targetIds.forEach((sid) => {
        const rr = rows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        const vals = rr.map((r) => toNumber(r[m])).filter((v) => v !== null);
        obj[sid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return obj;
    });
  }, [resultRows, tpoCols, filteredStudentIds, studentSelection, activeSemester]);

  const studentBarPO = useMemo(() => {
    const targetIds = studentSelection.length ? studentSelection : filteredStudentIds;
    if (!targetIds.length) return [];
    const rows = resultRows.filter((r) => String(r.semester ?? r.SEMESTER ?? "") === activeSemester && targetIds.includes(String(r.studentId ?? r["학번"] ?? r.ID)));
    if (!rows.length) return [];
    return poCols.map((m) => {
      const obj = { metric: m.replace(/_/g, "") };
      targetIds.forEach((sid) => {
        const rr = rows.filter((r) => String(r.studentId ?? r["학번"] ?? r.ID) === String(sid));
        const vals = rr.map((r) => toNumber(r[m])).filter((v) => v !== null);
        obj[sid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      });
      return obj;
    });
  }, [resultRows, poCols, filteredStudentIds, studentSelection, activeSemester]);

  const studentGrowthTPO = useMemo(() => aggregateOverTimeByStudent(resultRows, tpoCols, studentSelection), [resultRows, tpoCols, studentSelection]);
  const studentGrowthPO  = useMemo(() => aggregateOverTimeByStudent(resultRows, poCols,  studentSelection), [resultRows, poCols,  studentSelection]);

  // 파일 업로드 핸들러
  async function onUploadResults(e) {
    setError("");
    try {
      const files = Array.from(e.target.files || []);
      const parsed = await Promise.all(files.map(async (file) => {
        const rows = await parseFile(file);
        const ensured = ensureDept(rows, file.name).map((r) => ({
          ...r,
          studentId: r.studentId ?? r["학번"] ?? r["STUDENT ID"] ?? r["ID"],
          semester:  r.semester  ?? r["학기"] ?? r["SEMESTER"] ?? r["SNAPSHOT"] ?? r["TERM"],
        }));
        return { name: file.name, rows: ensured };
      }));
      setResultFiles((prev) => prev.concat(parsed));
    } catch (err) { setError(err.message || String(err)); }
  }
  async function onUploadGrades(e) {
    setError("");
    try {
      const files = Array.from(e.target.files || []);
      const parsed = await Promise.all(files.map(async (file) => ({ name: file.name, rows: await parseFile(file) })));
      setGradeFiles((prev) => prev.concat(parsed));
    } catch (err) { setError(err.message || String(err)); }
  }
  function removeResultFile(name) { setResultFiles((prev) => prev.filter((f) => f.name !== name)); }
  function removeGradeFile(name) { setGradeFiles((prev) => prev.filter((f) => f.name !== name)); }

  const tooltipFmt = (value, name) => [fmt2(value), name];
  const EmptyChartMessage = () => (
    <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-gray-500">
      현재 해당 학생의 전공역량 데이터가 충분하지 않아 출력되지 않습니다
    </div>
  );

  /** UI */
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-7xl p-6">
        <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">전공역량 대시보드 (TPO & PO 동시 비교)</h1>
            <p className="text-sm text-gray-500">전공/학생 단위 비교, 시점별 성장 그래프, 다중 필터(전공·성적·연도)를 제공합니다.</p>
            <p className="mt-1 text-lg text-blue-600 font-semibold"> 웹 제작자: 한국공학대학교 전공교육혁신센터 연구교수 이대영 </p>

          </div>
          <div className="flex rounded-full border overflow-hidden">
            <button onClick={() => setTabScope('DEPT')}    className={`px-3 py-1 ${tabScope==='DEPT'   ?'bg-gray-900 text-white':'bg-white'}`}>전공별</button>
            <button onClick={() => setTabScope('STUDENT')} className={`px-3 py-1 ${tabScope==='STUDENT'?'bg-gray-900 text-white':'bg-white'}`}>학생별</button>
          </div>
        </header>

        {/* 업로드 & 파일관리 */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold">① 결과 파일 업로드 (TPO/PO 역량점수)</h2>
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUploadResults} className="block w-full rounded-lg border p-2" />
            <p className="mt-2 text-xs text-red-500">데이터는 자동으로 업로드 되게끔 반영하였으니 넣을 필요가 없어요^^</p>
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-medium mb-1">업로드된 학생 개별 전공역량 파일</div>
              {resultFiles.length === 0 ? (
                <div className="text-xs text-gray-500">(없음)</div>
              ) : (
                <ul className="text-sm divide-y max-h-24 overflow-y-auto">
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
            <h2 className="mb-2 text-lg font-semibold">② 성적 데이터 업로드</h2>
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={onUploadGrades} className="block w-full rounded-lg border p-2" />
            <p className="mt-2 text-xs text-red-500"> 성적데이터는 크기가 커서 업로드 시간이 걸리니 10초 정도만 기다려주세요. </p>
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-medium mb-1">업로드된 성적 파일</div>
              {gradeFiles.length === 0 ? (
                <div className="text-xs text-gray-500">(없음)</div>
              ) : (
                <ul className="text-sm divide-y max-h-24 overflow-y-auto">
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
        </section>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}

        {/* 데이터 상태 */}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">학생별 전공역량 데이터 값(열 )</div>
            <div className="text-2xl font-bold">{resultRows.length.toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">PO 지표 {poCols.length}개 · TPO 지표 {tpoCols.length}개가 인식되었습니다.</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">학과 단위 성적 데이터 값(열) </div>
            <div className="text-2xl font-bold">{gradeRows.length.toLocaleString()}</div>
            <div className="mt-2 text-xs text-gray-500">(GPA 필터를 사용할 수 있습니다.)</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">전공 수</div>
            <div className="text-2xl font-bold">{allDepts.length}</div>
            <div className="mt-2 text-xs text-gray-500">선택: {deptSelection.join(" · ") || "미선택"}</div>
          </div>
        </section>

        {/* 학기 칩 */}
        <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium mr-2">학기</div>
            <button onClick={() => setSemester("")} className={`px-3 py-1 rounded-full border ${semester===''? 'bg-gray-900 text-white' : 'bg-white'}`}>전체</button>
            {allSemesters.map((s) => (
              <button key={String(s)} onClick={() => setSemester(String(s))} className={`px-3 py-1 rounded-full border ${semester===String(s)? 'bg-gray-900 text-white' : 'bg-white'}`}>{String(s)}</button>
            ))}
          </div>
        </section>

        {/* 전공별 / 학생별 */}
        {tabScope === 'DEPT' ? (
          (resultRows.length > 0 && (tpoCols.length > 0 || poCols.length > 0)) && (
            <section className="mt-6 space-y-6">
              {/* 전공 선택 */}
              <div className="rounded-2xl border bg-white p-4 shadow-sm flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium">전공 선택</label>
                <select multiple className="min-h-[44px] min-w-[260px] rounded-lg border p-2 text-sm" value={deptSelection}
                  onChange={(e) => { const opts = Array.from(e.target.selectedOptions).map((o) => o.value); setDeptSelection(opts); }}>
                  {allDepts.map((d) => (<option key={String(d)} value={String(d)}>{String(d)}</option>))}
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
                        {/* 고정축 40~100 */}
                        <YAxis domain={[40, 100]} />
                        <Tooltip formatter={tooltipFmt} /><Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (<Bar key={d} dataKey={d} barSize={22} fill={colorFor(d)} />))}
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
                        {/* 고정축 40~100 */}
                        <YAxis domain={[40, 100]} />
                        <Tooltip formatter={tooltipFmt} /><Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (<Bar key={d} dataKey={d} barSize={22} fill={colorFor(d)} />))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* 레이더 (반경축 0~100 고정) */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">TPO 레이더 그래프</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <RadarChart data={radarDataTPO}>
                        <PolarGrid /><PolarAngleAxis dataKey="axis" />
                        <PolarRadiusAxis domain={[0, 100]} />
                        {(deptSelection.length ? deptSelection : allDepts).map((d) => (
                          <Radar key={d} name={d} dataKey={d} stroke={colorFor(d)} fillOpacity={0} strokeWidth={2} />
                        ))}
                        <Legend /><Tooltip formatter={tooltipFmt} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">PO 레이더 그래프</h3>
                  <div className="h-[380px] w-full">
                    <ResponsiveContainer>
                      <RadarChart data={radarDataPO}>
                        <PolarGrid /><PolarAngleAxis dataKey="axis" />
                        <PolarRadiusAxis domain={[0, 100]} />
                        {(deptSelection.length ? deptSelection : allDepts).map((d) => (
                          <Radar key={d} name={d} dataKey={d} stroke={colorFor(d)} fillOpacity={0} strokeWidth={2} />
                        ))}
                        <Legend /><Tooltip formatter={tooltipFmt} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* 시점별 성장 (Y축 40~100 고정) */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">시점별 성장 (TPO 평균)</h3>
                  <div className="h-[360px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={deptGrowthTPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="semester" />
                        <YAxis domain={[40, 100]} />
                        <Tooltip formatter={tooltipFmt} /><Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (<Line key={d} type="monotone" dataKey={d} stroke={colorFor(d)} dot={true} strokeWidth={2} />))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-lg font-semibold">시점별 성장 (PO 평균)</h3>
                  <div className="h-[360px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={deptGrowthPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="semester" />
                        <YAxis domain={[40, 100]} />
                        <Tooltip formatter={tooltipFmt} /><Legend />
                        {(deptSelection.length? deptSelection : allDepts).map((d) => (<Line key={d} type="monotone" dataKey={d} stroke={colorFor(d)} dot={true} strokeWidth={2} />))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>
          )
        ) : (
          (resultRows.length > 0 && (tpoCols.length > 0 || poCols.length > 0)) && (
            <section className="mt-6 space-y-6">
              {/* 학생 필터 */}
              <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm font-medium">전공 필터</label>
                  <select multiple className="min-h-[44px] min-w-[260px] rounded-lg border p-2 text-sm"
                    value={studentDeptFilter}
                    onChange={(e) => { const opts = Array.from(e.target.selectedOptions).map((o) => o.value); setStudentDeptFilter(opts); }}>
                    {allDepts.map((d) => (<option key={String(d)} value={String(d)}>{String(d)}</option>))}
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
                    <div className="text-sm font-medium mb-1 flex items-center gap-2">
                      <span>학번 선택(다중)</span>
                      {/* 학번 부분검색 입력 */}
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="학번 검색 (예: 20183)"
                        className="ml-2 w-44 rounded-md border px-2 py-1 text-sm"
                      />
                    </div>
                    <select multiple size={8} className="min-w-[260px] rounded-lg border p-2 text-sm"
                      value={studentSelection}
                      onChange={(e) => { const opts = Array.from(e.target.selectedOptions).map((o) => o.value); setStudentSelection(opts); }}>
                      {shownStudentIds.map((sid) => (
                        <option key={String(sid)} value={String(sid)}>
                          {String(sid)} {gpaIndex.has(String(sid)) ? ` (GPA ${fmt2(gpaIndex.get(String(sid)))})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-red-500 max-w-sm">
                    Tip: 전공·성적·연도 필터를 조합한 뒤 학번을 선택하세요. 
                    <br />검색창에 일부만 입력해도 학번이 목록에 표시됩니다. 
                    <br /> <b>(ctrl, cmd 키를 눌러서 다중비교 가능)</b>
                  </div>
                </div>
              </div>

              {/* 학생 막대/성장 */}
              {studentSelection.length >= 1 && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 TPO 지표 (학기: {activeSemester || '전체'})</h3>
                    <div className="h-[380px] w-full">
                      {studentBarTPO.length === 0 ? <EmptyChartMessage /> : (
                        <ResponsiveContainer>
                          <BarChart data={studentBarTPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                            <YAxis domain={[0, 100]} />
                            <Tooltip formatter={tooltipFmt} /><Legend />
                            {studentSelection.map((sid) => (<Bar key={sid} dataKey={sid} barSize={20} fill={colorFor(sid)} />))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 PO 지표 (학기: {activeSemester || '전체'})</h3>
                    <div className="h-[380px] w-full">
                      {studentBarPO.length === 0 ? <EmptyChartMessage /> : (
                        <ResponsiveContainer>
                          <BarChart data={studentBarPO} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="metric" angle={-20} textAnchor="end" interval={0} height={60} />
                            <YAxis domain={[0, 100]} />
                            <Tooltip formatter={tooltipFmt} /><Legend />
                            {studentSelection.map((sid) => (<Bar key={sid} dataKey={sid} barSize={20} fill={colorFor(sid)} />))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {studentSelection.length >= 1 && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 시점별 성장 (TPO 평균)</h3>
                    <div className="h-[360px] w-full">
                      {studentGrowthTPO.length === 0 ? <EmptyChartMessage /> : (
                        <ResponsiveContainer>
                          <LineChart data={studentGrowthTPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="semester" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip formatter={tooltipFmt} /><Legend />
                            {studentSelection.map((sid) => (<Line key={sid} type="monotone" dataKey={sid} stroke={colorFor(sid)} dot={true} strokeWidth={2} />))}
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-lg font-semibold">학생별 시점별 성장 (PO 평균)</h3>
                    <div className="h-[360px] w-full">
                      {studentGrowthPO.length === 0 ? <EmptyChartMessage /> : (
                        <ResponsiveContainer>
                          <LineChart data={studentGrowthPO} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="semester" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip formatter={tooltipFmt} /><Legend />
                            {studentSelection.map((sid) => (<Line key={sid} type="monotone" dataKey={sid} stroke={colorFor(sid)} dot={true} strokeWidth={2} />))}
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

          
      </div>
    </div>
  );
}

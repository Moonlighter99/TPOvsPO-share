# TPO·PO Dashboard (Vite + React + Tailwind)

이 저장소는 TPO/PO 성과 데이터를 CSV/XLSX로 업로드하여 전공/학생 단위로 시각화하는 대시보드입니다.
- 프레임워크: Vite + React
- 스타일: Tailwind CSS
- 차트: Recharts
- 파서: PapaParse (CSV), SheetJS/xlsx (Excel)

## 로컬 실행
```bash
npm i         # 또는 npm ci
npm run dev   # http://localhost:5173
```

## 프로덕션 빌드
```bash
npm run build    # dist/ 생성
npm run preview  # 로컬 미리보기
```

## GitHub → Vercel 배포
1. 이 폴더를 깃허브 저장소에 그대로 푸시합니다. (`package.json`, `vite.config.js`, `index.html`, `src/`, `public/`, `vercel.json` 포함)
2. vercel.com → Add New → Import Git Repository → 해당 저장소 선택
3. Framework: Vite(자동 인식) / Build Command: `npm run build` / Output: `dist`
4. Deploy 클릭
5. (필요 시) 환경변수는 Vercel 프로젝트의 **Settings → Environment Variables**에서 `VITE_` 접두어로 등록하세요.

## 데이터 형식
- 결과 파일: PO_x, TPO_x 컬럼을 포함한 CSV 또는 XLSX (Long형 Metric/Value도 자동 Pivot 지원)
- 성적 파일(선택): GPA 컬럼 포함 시 성적 구간(2점대 이하/3점대/4점대+) 필터 적용

## 주의
- `node_modules`, `dist`, `.vercel`, `.env*`는 커밋하지 마세요.
- 전공 컬럼이 없을 경우 파일명에서 전공을 추정하여 자동 주입합니다.

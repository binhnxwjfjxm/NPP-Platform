import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const readWorkspace = async () => (await Promise.all([read('app/page.tsx'), read('app/retail-workspace.tsx')])).join('\n');

test('Retail khóa Auto Deploy trên Vercel', async () => { const config = JSON.parse(await read('vercel.json')); assert.equal(config.git?.deploymentEnabled, false); });
test('bootstrap chỉ tạo/cấu hình project và không deploy', async () => { const source = await read('scripts/bootstrap-project.sh'); assert.match(source, /v11\/projects/); assert.match(source, /rootDirectory/); assert.match(source, /retail\.nguyenlieuhungphat\.com/); assert.doesNotMatch(source, /vercel@[^\n]+ deploy/); assert.doesNotMatch(source, /vercel@[^\n]+ build/); });
test('production Retail chỉ chạy bằng lệnh issue chính xác và khóa đúng Vercel project', async () => { const [workflow, script] = await Promise.all([readRepo('.github/workflows/vercel-retail-production-manual.yml'), read('scripts/deploy-production.sh')]); assert.match(workflow, /github\.event\.issue\.number == 5/); assert.match(workflow, /github\.event\.comment\.body == '\/deploy-vercel-retail-production'/); assert.match(workflow, /DEPLOY_REF: main/); assert.match(workflow, /RETAIL_ROOT_DIRECTORY: retail\/web/); assert.match(workflow, /RETAIL_PROJECT_NAME: npp-retail/); assert.doesNotMatch(workflow, /\npush:/); assert.match(script, /VERCEL_PROJECT_ID is required/); assert.match(script, /test "\$VERCEL_PROJECT_ID" = "\$project_id"/); assert.match(script, /curl --silent --show-error --location/); });
test('Retail giữ URL API Công Ty ở phía server', async () => { const envExample = await read('.env.example'); const route = await read('app/api/cong-ty/health/route.ts'); assert.match(envExample, /^CORE_API_INTERNAL_URL=/m); assert.doesNotMatch(envExample, /NEXT_PUBLIC_CORE_API/); assert.match(route, /process\.env\.CORE_API_INTERNAL_URL/); });
test('ngôn ngữ màn hình dùng Công Ty', async () => { const page = await readWorkspace(); assert.match(page, /Công Ty/); assert.doesNotMatch(page, />[^<]*(Core|NPP)[^<]*</); });

import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

it('keeps both verticals independent and partner-supply on the approved core module dependencies', () => {
  const configPath = resolve('tsconfig.json');
  const sourceRoot = resolve('src');
  const modules = join(sourceRoot, 'modules');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) throw new Error('Unable to read TypeScript module aliases');
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd());
  const allowedCore = new Set(['wallet-escrow', 'cities-branches', 'notifications']);
  const forbidden: string[] = [];

  for (const source of ['security-services', 'partner-supply']) {
    for (const file of sourceFiles(join(modules, source))) {
      const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
      for (const { fileName } of imports) {
        const target = ts.resolveModuleName(fileName, file, options, ts.sys).resolvedModule?.resolvedFileName;
        if (!target) continue;
        const targetPath = relative(sourceRoot, target);
        if (targetPath.startsWith(`..${sep}`) || isAbsolute(targetPath)) continue;
        const [layer, module] = targetPath.split(sep);
        const crossVertical = layer === 'modules' && source === 'security-services' && module === 'partner-supply';
        const otherModule = layer === 'modules' && module !== source && (!module || !allowedCore.has(module));
        const otherInfra = layer === 'infrastructure' && module !== 'prisma';
        if (crossVertical || (source === 'partner-supply' && (otherModule || otherInfra))) {
          forbidden.push(`${relative(modules, file)} → ${fileName}`);
        }
      }
    }
  }

  expect(forbidden).toEqual([]);
});

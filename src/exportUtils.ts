import type { OHLCVData } from './types';

export function downloadScreenshotFromCanvas(canvas: HTMLCanvasElement, symbol: string) {
  const link = document.createElement('a');
  link.download = `${symbol}_chart_${new Date().toISOString().split('T')[0]}.png`;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportOHLCVtoCSV(data: OHLCVData[], symbol: string) {
  const header = 'Datum,Eroeffnung,Hoch,Tief,Schluss,Volumen\n';
  const rows = data
    .map((d) => {
      const dateStr = typeof d.date === 'number'
        ? new Date(d.date * 1000).toISOString().replace('T', ' ').substring(0, 19)
        : d.date;
      return `${dateStr},${d.open},${d.high},${d.low},${d.close},${d.volume}`;
    })
    .join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${symbol}_OHLCV_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

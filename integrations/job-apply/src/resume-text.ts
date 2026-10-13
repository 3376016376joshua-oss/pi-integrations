import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extracts plain text from a PDF, one output line per visual line. */
export async function pdfToText(data: Uint8Array): Promise<string> {
	const pdf = await getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
	try {
		const pages: string[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const content = await (await pdf.getPage(i)).getTextContent();
			const lines: string[] = [];
			let line = "";
			let lastY: number | undefined;
			for (const item of content.items) {
				if (!("str" in item)) continue;
				const y = item.transform[5] as number;
				if (lastY !== undefined && Math.abs(y - lastY) > 2) {
					lines.push(line.trim());
					line = "";
				}
				line += item.str + (item.hasEOL ? "" : " ");
				lastY = y;
			}
			lines.push(line.trim());
			pages.push(lines.filter(Boolean).join("\n"));
		}
		return pages.join("\n\n").replace(/ {2,}/g, " ");
	} finally {
		await pdf.destroy();
	}
}

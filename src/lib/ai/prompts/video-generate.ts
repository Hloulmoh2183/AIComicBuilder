export function buildVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  startFrameDesc?: string;
  endFrameDesc?: string;
  sceneDescription?: string;       // kept for call-site compatibility, not used in output
  duration?: number;
  characterDescriptions?: string;  // kept for call-site compatibility, not used in output
  dialogues?: Array<{ characterName: string; text: string }>;
}): string {
  const lines: string[] = [];

  lines.push(`Smoothly interpolate from the first frame to the last frame.`);
  lines.push(``);
  lines.push(`[MOTION]`);
  lines.push(params.videoScript);
  lines.push(``);
  lines.push(`[CAMERA]`);
  lines.push(params.cameraDirection);

  const hasStart = !!params.startFrameDesc;
  const hasEnd = !!params.endFrameDesc;
  if (hasStart || hasEnd) {
    lines.push(``);
    lines.push(`[FRAME ANCHORS]`);
    if (hasStart) lines.push(`Opening frame: ${params.startFrameDesc}`);
    if (hasEnd) lines.push(`Closing frame: ${params.endFrameDesc}`);
  }

  if (params.dialogues?.length) {
    lines.push(``);
    lines.push(`[DIALOGUE]`);
    for (const d of params.dialogues) {
      lines.push(`- ${d.characterName} says: "${d.text}"`);
    }
  }

  return lines.join("\n");
}

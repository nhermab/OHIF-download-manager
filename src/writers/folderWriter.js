import { fileName } from "../manifest.js";
import { sanitize } from "../utils.js";

export class FolderWriter {
  constructor(root) {
    this.root = root;
    this.name = "folder";
  }

  async write(item, blob) {
    const patientName = sanitize(item.patientDir, "UNKNOWN_PATIENT");
    const studyName = sanitize(item.studyDir, "UNKNOWN_STUDY");
    const seriesName = sanitize(item.seriesDir, "UNKNOWN_SERIES");
    const filename = fileName(item);

    const patientDir = await this.root.getDirectoryHandle(patientName, { create: true });
    const studyDir = await patientDir.getDirectoryHandle(studyName, { create: true });
    const seriesDir = await studyDir.getDirectoryHandle(seriesName, { create: true });
    const fileHandle = await seriesDir.getFileHandle(filename, { create: true });

    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.close().catch(() => {});
      throw error;
    }
  }

  async writeArtifact(name, blob) {
    const fileHandle = await this.root.getFileHandle(sanitize(name, 'export-artifact'), {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.close().catch(() => {});
      throw error;
    }
  }
}

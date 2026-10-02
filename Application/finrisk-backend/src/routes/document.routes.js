import express from "express";
import multer from "multer";
import { uploadDocument } from "../controllers/document.controller.js";

const router = express.Router();

// Formats the Document Agent can currently read.
// CSV / Excel will be added here once document.service.js supports them.
const SUPPORTED_TYPES = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    // Keep only safe characters from the original name.
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (Object.hasOwn(SUPPORTED_TYPES, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported document format"));
    }
  }
});

// Wraps multer so its errors come back as clean JSON instead of
// Express's default HTML error page.
function handleUpload(req, res, next) {
  upload.single("document")(req, res, (error) => {
    if (!error) return next();

    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 415).json({
      success: false,
      stage: "upload",
      message: tooLarge
        ? "File is too large (max 20 MB)"
        : "Unsupported document format",
      error: error.message
    });
  });
}

router.post("/upload", handleUpload, uploadDocument);

export default router;

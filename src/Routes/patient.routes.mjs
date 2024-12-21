import { Router } from "express";

import { verifyJWT } from "../Middlewares/auth.middleware.mjs";
import { acceptChart, addChatReport, addDoctor, addReport, getDoctorList, getReportList, patientChat, queryDateVal, queryReports, removeDoctor, removeReport, reportAddSignedURL, getCharts, removeChart, getMedicines, toggleMedicineStatus } from "../Controllers/patient.controller.mjs";

const router = Router();

// secured routs
router.route("/getDoctorList").post(verifyJWT, getDoctorList);
router.route("/addDoctor").post(verifyJWT, addDoctor);
router.route("/getReportList").post(verifyJWT, getReportList);
router.route("/addReport").post(verifyJWT, addReport);
router.route("/addChatReport").post(verifyJWT, addChatReport);
router.route("/removeDoctor").post(verifyJWT, removeDoctor);
router.route("/reportAddSignedURL").post(verifyJWT, reportAddSignedURL);
router.route("/removeReport").post(verifyJWT, removeReport);
router.route("/queryReports").post(verifyJWT, queryReports);
router.route("/queryDateVal").post(verifyJWT, queryDateVal);
router.route("/acceptChart").post(verifyJWT, acceptChart);
router.route("/chat").post(verifyJWT, patientChat);
router.route("/getCharts").post(verifyJWT, getCharts);
router.route("/removeChart").post(verifyJWT, removeChart);
router.route("/getMedicines").post(verifyJWT, getMedicines);
router.route("/toggleMedicineStatus").post(verifyJWT, toggleMedicineStatus);

export default router;
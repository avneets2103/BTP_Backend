import { Router } from "express";

import { verifyJWT } from "../Middlewares/auth.middleware.js";
import { addMedicine, doctorChat, emptyMedicineList, generatePatientCode, getPatientList, getPatientMedical, removeMedicine, removePatient, saveDoctorNote } from "../Controllers/doctor.controller.js";

const router = Router();

// secured routs
router.route("/getPatientList").post(verifyJWT, getPatientList);
router.route("/generatePatientCode").post(verifyJWT, generatePatientCode);
router.route("/getPatientMedical").post(verifyJWT, getPatientMedical);
router.route("/removePatient").post(verifyJWT, removePatient);
router.route("/saveDoctorNote").post(verifyJWT, saveDoctorNote);  
router.route("/addMedicine").post(verifyJWT, addMedicine);
router.route("/removeMedicine").post(verifyJWT, removeMedicine);  
router.route("/emptyMedicineList").post(verifyJWT, emptyMedicineList);
router.route("/doctorChat").post(verifyJWT, doctorChat);

export default router;
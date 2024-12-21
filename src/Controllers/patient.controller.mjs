import { asyncHandler } from "../Utils/asyncHandler.mjs";
import ApiError from "../Utils/ApiError.mjs";
import ApiResponse from "../Utils/ApiResponse.mjs";
import { User } from "../Models/user.model.mjs"; // Ensure correct import paths
import { Patient } from "../Models/patient.model.mjs";
import { Doctor } from "../Models/doctor.model.mjs";
import jwt from "jsonwebtoken";
import { extractTextFromPDF, getObjectURL, putObjectURL } from "../Utils/s3.mjs";
import { makeUniqueFileName } from "../Utils/helpers.mjs";
import axios from "axios";

const getDoctorList = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("patientDetails");

    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }

    const patient = await Patient.findById(user.patientDetails._id).populate(
      "doctorsList"
    );

    if (!patient) {
      throw new ApiError(404, "Patient details not found");
    }

    const doctorList = [];
    for (const doctor of patient.doctorsList) {
      doctor.imageLink = await getObjectURL(doctor.imageLink);
      doctor.patientsList = [];
      doctorList.push(doctor);
    }
    doctorList.reverse();
    return res
      .status(200)
      .json(
        new ApiResponse(200, doctorList, "Doctor list retrieved successfully")
      );
  } catch (error) {
    console.error("Error in getDoctorList:", error); // Log the actual error for better debugging
    throw new ApiError(500, "Something went wrong in getDoctorList");
  }
});

const removeDoctor = asyncHandler(async (req, res) => {
  try {
    const { doctorId } = req.body;
    const user = await User.findById(req.user._id).populate("patientDetails");
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id);
    const index = patient.doctorsList.indexOf(doctorId);
    if (index > -1) {
      patient.doctorsList.splice(index, 1);
      await patient.save();
    }
    const doctor = await Doctor.findById(doctorId);
    const index2 = doctor.patientsList.indexOf(patient._id);
    if (index2 > -1) {
      doctor.patientsList.splice(index2, 1);
      await doctor.save();
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          doctorsList: patient.doctorsList,
          patientsList: doctor.patientsList,
        },
        "Doctor removed successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in removeDoctor");
  }
});

const addDoctor = asyncHandler(async (req, res) => {
  try {
    const { doctorGeneratedOneTimeToken } = req.body;

    // Verify the token
    const decoded = jwt.verify(
      doctorGeneratedOneTimeToken,
      process.env.DOCTOR_TOKEN_SECRET
    );
    const doctorId = decoded.doctorId; // doctor's doctor ID
    const patientId = decoded.patientId; // patient's patient ID

    if (patientId !== req.user.patientDetails._id.toString()) {
      throw new ApiError(401, "Unauthorized access");
    }

    const patient = await Patient.findById(patientId);
    const doctor = await Doctor.findById(doctorId);

    if (!patient.doctorsList.includes(doctorId)) {
      patient.doctorsList.push(doctorId);
      await patient.save();
    }

    if (!doctor.patientsList.includes(patientId)) {
      doctor.patientsList.push(patientId);
      await doctor.save();
    }

    // Return the doctor's data
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          doctorPatients: doctor.patientsList,
          patientDoctors: patient.doctorsList,
        },
        "Doctor added successfully"
      )
    );
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      throw new ApiError(401, "Invalid or expired token");
    }
    throw new ApiError(500, "Something went wrong in addDoctor");
  }
});

const getReportList = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("patientDetails");
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }

    const patient = await Patient.findById(user.patientDetails._id).populate(
      "reportsList"
    );

    if (!patient) {
      throw new ApiError(404, "Patient details not found");
    }

    // Helper function to parse "DD/MM/YY" to a Date object
    const parseDate = (dateString) => {
      const [day, month, year] = dateString.split("/").map(Number);
      // Ensure the year is handled correctly for "YY" format (e.g., "23" => "2023")
      const fullYear = year < 100 ? 2000 + year : year;
      return new Date(fullYear, month - 1, day);
    };

    // Sort reports in descending order of reportDate
    const sortedReportsList = patient.reportsList
      .map(report => ({
        ...report.toObject(), // Convert Mongoose document to plain object
      }))
      .sort((a, b) => parseDate(b.reportDate) - parseDate(a.reportDate));

      const reportList = [];
      for (const report of sortedReportsList) {
        report.reportPDFLink = await getObjectURL(report.reportPDFLink);
        reportList.push(report);
      }

    return res.status(200).json(
      new ApiResponse(200, reportList, "Report list retrieved successfully")
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in getReportList");
  }
});

const addReport = asyncHandler(async (req, res) => {
  try {
    const { reportName, location, reportDate, reportPDFLink } = req.body;
    const user = await User.findById(req.user._id).populate("patientDetails");

    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id);
    ("");

    const reportPDFText = await extractTextFromPDF(reportPDFLink);

    // knowledge base update here
    const cntOfReports = patient.reportsList.length;
    let absText = patient.absoluteSummary;
    if(cntOfReports > 0 && cntOfReports % 10 === 0){
      // reset absolute summary
      let newAbsoluteText = "";
      newAbsoluteText += patient.lastAbsoluteSummary;
      let cnt = 9;
      let index = cntOfReports - 1;
      while(index-- && cnt--){
        newAbsoluteText += patient.reportsList[index].reportSummary;
      }
      absText = newAbsoluteText;
    }
    const reportSummary = await axios.post(`${process.env.FLASK_SERVER}/reports/update_kb`, {
      reportText: reportPDFText,
      absoluteText: absText,
    });
    if(cntOfReports > 0 && cntOfReports % 10 === 0){
      patient.lastAbsoluteSummary = reportSummary.data.newAbsoluteText;
    }

    // Add report details to patient's reportsList
    const newReport = {
      reportName,
      reportDate,
      location,
      reportPDFLink,
      reportPDFText,
      reportSummary: reportSummary.data.indReportSummary,
    };
    patient.reportsList.push(newReport);
    patient.absoluteSummary = reportSummary.data.newAbsoluteText;
    await patient.save();

    // report embedding here
    const reportEmbedding = await axios.post(`${process.env.FLASK_SERVER}/reports/embed_report`, {
      reportText: reportPDFText,
      reportId: patient.reportsList[patient.reportsList.length - 1]._id,
      patientId: patient._id,
      url: await getObjectURL(reportPDFLink),
      date: reportDate
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          patient: patient,
          reportSummary: newReport.reportSummary,
        },
        "Report added successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in addReport");
  }
});

const addChatReport = asyncHandler(async (req, res) => {
  try {
    const { reportDate, reportPDFText } = req.body;
    const user = await User.findById(req.user._id).populate("patientDetails");

    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id);
    ("");

    // knowledge base update here
    const cntOfReports = patient.reportsList.length;
    let absText = patient.absoluteSummary;
    if(cntOfReports > 0 && cntOfReports % 10 === 0){
      // reset absolute summary
      let newAbsoluteText = "";
      newAbsoluteText += patient.lastAbsoluteSummary;
      let cnt = 9;
      let index = cntOfReports - 1;
      while(index-- && cnt--){
        newAbsoluteText += patient.reportsList[index].reportSummary;
      }
      absText = newAbsoluteText;
    }
    const reportSummary = await axios.post(`${process.env.FLASK_SERVER}/reports/update_kb`, {
      reportText: reportPDFText,
      absoluteText: absText,
    });
    if(cntOfReports > 0 && cntOfReports % 10 === 0){
      patient.lastAbsoluteSummary = reportSummary.data.newAbsoluteText;
    }

    patient.absoluteSummary = reportSummary.data.newAbsoluteText;
    await patient.save();

    // report embedding here
    const reportEmbedding = await axios.post(`${process.env.FLASK_SERVER}/reports/embed_report`, {
      reportText: reportPDFText,
      reportId: "chat based report",
      patientId: patient._id,
      url: "chat based report",
      date: reportDate
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          patient: patient,
        },
        "Chat Report added successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in addReport");
  }
})

const reportAddSignedURL = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("patientDetails");
    const { reportName } = req.body;
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id);
    const nameOfFile = `Reports/${makeUniqueFileName(reportName, user._id.toString())}.pdf`;
    const url = await putObjectURL(nameOfFile, "application/pdf", 600);
    await patient.save();
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          url: url,
          reportPDFLink: nameOfFile,
        },
        "Report signed URL added successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in reportAddSignedURL");
  }
});

const removeReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.body;
    const user = await User.findById(req.user._id).populate("patientDetails");
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id);
    let index = -1;
    let i = 0;
    for (const report of patient.reportsList) {
      if (report._id.toString() === reportId) {
        index = i;
        break;
      }
      i++;
    }
    if (index > -1) {
      patient.reportsList.splice(index, 1);
      await patient.save();
    }
    return res
      .status(200)
      .json(
        new ApiResponse(200, patient.reportsList, "Report removed successfully")
      );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in removeReport");
  }
});

const queryReports = asyncHandler(async (req, res) => {
  try {
    let { patientId, queryText } = req.body;
    if(!req.user.isDoctor){
      patientId = req.user.patientDetails._id;
    }
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    const queryRes = await axios.post(`${process.env.FLASK_SERVER}/reports/generalReportQuery`, {
      patientId,
      queryText,
    });
    return res
      .status(200)
      .json(
        new ApiResponse(200, {
          response: queryRes.data.response,
          sources: queryRes.data.sources,
        }, "Report list retrieved successfully")
      );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in getReportList");
  }
});

const queryDateVal = asyncHandler(async (req, res) => {
  try {
    let { patientId, queryText } = req.body;
    if(!req.user.isDoctor){
      patientId = req.user.patientDetails._id;
    }
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }
    const queryRes = await axios.post(`${process.env.FLASK_SERVER}/reports/dateValQuery`, {
      patientId,
      queryText,
    });
    return res
      .status(200)
      .json(
        new ApiResponse(200, queryRes.data, "Report list retrieved successfully")
      );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in getReportList");
  }
});

const acceptChart = asyncHandler(async (req, res) => {
  try {
    let {patientId, chartName, data, queryText, description, sourceList, unit} = req.body;
    if(!req.user.isDoctor){
      patientId = req.user.patientDetails._id.toString();
    }
    if(!chartName || !data || !queryText || !description){
      throw new ApiError(400, "Missing required fields");
    }
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    const chart = await Patient.findOneAndUpdate(
      { _id: patientId },
      {
        $push: {
          chartsList: {
            chartName,
            data,
            queryText,
            description,
            sourceList,
            unit
          }
        }
      },
      { new: true }
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          patient: chart,
        },
        "Chart added successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in Accept Chart");
  }
});

const patientChat = asyncHandler(async (req, res) => {
  try {
    const {prompt, context} = req.body;
    if(req.user.isDoctor){
      throw new ApiError(401, "Unauthorized access");
    }

    const user = await User.findById(req.user._id);
    const patient = await Patient.findById(user.patientDetails._id);
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    // get the medicine list from the patient
    const medicineList = patient.medicinesList;
    let medicines = "";
    for (const medicine of medicineList) {
      medicines += medicine.medicine + ", ";
    }
    // get the doctor notes for this patient
    const doctorNotes = await patient.doctorsNotes;
    let notes = "";
    for (const note of doctorNotes) {
      notes += note.note + ", ";
    }

    const resp =  await axios.post(`${process.env.FLASK_SERVER}/patientChat/chat`, {
      prompt,
      context,
      medicines,
      notes,
      patientId: req.user.patientDetails._id
    })

    return res.status(200).json(
      new ApiResponse(
        200,
        resp.data,
        "Chat response added successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in Accept Chart");
  }
});

const getCharts = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("patientDetails");
    if (!user || !user.patientDetails) {
      throw new ApiError(404, "Patient not found");
    }
    const patient = await Patient.findById(user.patientDetails._id).populate("chartsList");
    if (!patient) {
      throw new ApiError(404, "Patient details not found");
    }
    const chartsList = [];
    for (const chart of patient.chartsList) {
      const newChart = {
        id: chart._id,
        name: chart.chartName,
        data: chart.data,
        description: chart.description,
        sourceList: chart.sourceList,
        queryText: chart.queryText,
        unit: chart.unit
      };
      chartsList.push(newChart);
    }
    chartsList.reverse();
    return res
      .status(200)
      .json(
        new ApiResponse(200, chartsList, "Chart list retrieved successfully")
      );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in getCharts");
  }
});

const removeChart = asyncHandler(async (req, res) => {
  try {
    let { chartId, patientId } = req.body;
    if(!req.user.isDoctor){
      patientId = req.user.patientDetails._id;
    }
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }
    let index = -1;
    let i = 0;
    for (const chart of patient.chartsList) {
      if (chart._id.toString() === chartId) {
        index = i;
        break;
      }
      i++;
    }
    if (index > -1) {
      patient.chartsList.splice(index, 1);
      patient.chartsList = patient.chartsList.filter((chart) => {
        return chart && chart.chartName && chart.queryText;
      });
      await patient.save();
    }
    return res
      .status(200)
      .json(
        new ApiResponse(200, patient.chartsList, "Chart removed successfully")
      );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in removeChart");
  }
});

const getMedicines = asyncHandler(async (req, res) => {
  try {
    let { patientId } = req.body;
    if (!req.user.isDoctor) {
      patientId = req.user.patientDetails._id.toString();
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    const currDate = new Date().setHours(0, 0, 0, 0); // Normalize to local timezone midnight

    // Check if the medicineStatusDate is the same as the current date (local time)
    const medicineStatusDate = new Date(patient.medicineStatusDate).setHours(0, 0, 0, 0);

    let newMedicinesList = [];
    
    // If medicineStatusDate matches the current date, return the medicines with the existing status
    if (medicineStatusDate === currDate) {
      for (const medicine of patient.medicinesList) {
        const doctor = await Doctor.findById(medicine.doctor); // Await doctor name fetch
        const newMed = {
          id: medicine._id,
          medicine: medicine.medicine,
          dosage: medicine.dosage,
          doctor: doctor.name,
          status: medicine.status,
          doctorId: medicine.doctor,
        };
        newMedicinesList.push(newMed);
      }

      // Sort medicines: Pending first, taken last
      newMedicinesList.sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return 0;
      });

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            medicinesList: newMedicinesList,
            medicineStatusDate: patient.medicineStatusDate,
          },
          "Medicines list retrieved successfully"
        )
      );
    } else {
      patient.medicineStatusDate = currDate;
      await patient.save();
      
      // If dates don't match, set pending status for all medicines and update in DB
      const newMedicineList = [];
      const dbNewMedicineList = [];
      for (const medicine of patient.medicinesList) {
        // Update status to 'pending' in the database
        medicine.status = "pending";
    
        // Fetch the doctor's name for the response
        const doctor = await Doctor.findById(medicine.doctor);
    
        const newMed = {
          id: medicine._id,
          medicine: medicine.medicine,
          dosage: medicine.dosage,
          doctor: doctor.name,
          status: "pending",
          doctorId: medicine.doctor,
        };
        const newDbMed = {
          medicine: medicine.medicine,
          dosage: medicine.dosage,
          doctor: medicine.doctor,
          status: "pending",
        };
        dbNewMedicineList.push(newDbMed);
        newMedicineList.push(newMed);
      }

      // Sort medicines: Pending first, taken last
      newMedicineList.sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return 0;
      });

      // Update the patient document with new medicine list
      patient.medicinesList = dbNewMedicineList;
      await patient.save();
    
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            medicinesList: newMedicineList,
            medicineStatusDate: currDate, // Optionally update the medicine status date if needed
          },
          "Medicines status updated to pending and retrieved successfully"
        )
      );
    }    
  } catch (error) {
    console.error(error); // Log the error for better debugging
    throw new ApiError(500, "Something went wrong in getMedicines");
  }
});

const toggleMedicineStatus = asyncHandler(async (req, res) => {
  try {
    const { medicineId, status } = req.body;
    console.log(medicineId);

    // Prevent access for doctors
    if (req.user.isDoctor) {
      throw new ApiError(401, "Unauthorized access");
    }

    // Fetch the user's patient
    const user = await User.findById(req.user._id).populate("patientDetails");
    const patient = await Patient.findById(user.patientDetails._id);
    
    // If the patient doesn't exist
    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    let newMedicineList = JSON.parse(JSON.stringify(patient.medicinesList));
    
    let index = patient.medicinesList.findIndex(m => m._id.toString() === medicineId.toString());
    if (index > -1) {
      // remove the medicine from the new medicinelist
      newMedicineList.splice(index, 1);
    }
    else {
      throw new ApiError(404, "Medicine not found");
    }
    let newMed = patient.medicinesList[index];
    newMed.status = status;
    newMedicineList.push(newMed);

    patient.medicinesList = newMedicineList;
    console.log(patient.medicinesList);
    try {
      await patient.validate(); // Validate the document without saving
      await patient.save();
    } catch (err) {
      console.error("Validation Error:", err.message);
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          medicinesList: patient.medicinesList,
        },
        "Medicine updated successfully"
      )
    );
  } catch (error) {
    throw new ApiError(500, "Something went wrong in toggleMedicineStatus");
  }
});


export {
  getDoctorList,
  addDoctor,
  getReportList,
  addReport,
  removeDoctor,
  reportAddSignedURL,
  removeReport,
  queryReports,
  queryDateVal, 
  acceptChart,
  addChatReport,
  patientChat,
  getCharts,
  removeChart,
  getMedicines,
  toggleMedicineStatus
};

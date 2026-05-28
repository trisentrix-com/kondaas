// src/controllers/queueEngine.js
import { withDatabase } from '../utils/config.js';
import { getSolarmanDataCore } from './solarmanController.js'; 
import admin from 'firebase-admin';

// 🚀 Helper function to send notifications for cascading leads (KEEPS CUSTOM SOUND)
const sendLeadFCMNotification = async (deviceToken, customerName, leadId, kilovolt, address) => {
  try {
    if (!deviceToken) return false;

    const kvInfo = kilovolt ? ` [${kilovolt}]` : "";
    const addrInfo = address ? ` at ${address}` : "";
    const statusBody = `Customer: ${customerName || "New"}${kvInfo}${addrInfo}. Tap to accept.`;
    const statusTitle = "New Lead Assigned!";

    const response = await admin.messaging().send({
      token: deviceToken.trim(),
      android: {
        priority: "high",
        notification: {
          title: statusTitle,
          body: statusBody,
          sound: "kondaas", // ✅ Kept for lead alerts
          channelId: "custom_sound_channel_v2",
          clickAction: "LEAD_NOTIFICATION_ACTION",
        }
      },
      data: {
        type: "new_order",
        title: statusTitle,
        body: statusBody,
        customerName: String(customerName || "New Customer"),
        leadId: leadId ? leadId.toString() : "",
        kilovolt: kilovolt ? String(kilovolt) : "",
        address: address || "",
        show_actions: "true"
      }
    });

    console.log("🚀 FCM Server Accepted Lead Message ID:", response);
    return true;
  } catch (err) {
    console.error("❌ Firebase Admin SDK Lead Exception:", err.message);
    return false;
  }
};

export const startQueueRunner = () => {
  console.log("⏳ Mongo Queue Runner Started (30-Second Dynamic Mode)...");

  setInterval(async () => {
    try {
      const now = new Date();
      const mongoUri = process.env.MONGODB_URI;

      if (!mongoUri) return;

      await withDatabase(mongoUri, async (db) => {
        
        // 🔍 MULTI-TASK LOOKUP: Find any pending task that is ready to run right now
        const job = await db.collection("jobs_queue").findOneAndUpdate(
          {
            status: "pending",
            runAt: { $lte: now }
          },
          {
            $set: { status: "processing", lockedAt: now }
          },
          {
            returnDocument: "after"
          }
        );

        if (!job) return; 

        console.log(`🚀 Found active task to run: [${job.taskType}] (ID: ${job._id})`);

        // 🔀 TASK ROUTER
        switch (job.taskType) {
          case "WEEKLY_MASTER_SOLAR_SUMMARY":
            await processAllCustomersWeeklyJobs(db, job);
            break;

          case "MONTHLY_MASTER_SOLAR_SUMMARY": // ✅ Added monthly routing task
            await processAllCustomersMonthlyJobs(db, job);
            break;

          case "SURVEYOR_CASCADING_DISPATCH":
            await handleCascadingDispatchJob(db, job);
            break;

          default:
            console.log(`⚠️ Unknown task type encountered: ${job.taskType}`);
            await db.collection("jobs_queue").updateOne(
              { _id: job._id },
              { $set: { status: "failed", reason: "Unknown task type" } }
            );
        }
      });

    } catch (error) {
      console.error("❌ Error in Master Queue Runner loop:", error);
    }
  }, 30000);
};

const handleCascadingDispatchJob = async (db, job) => {
  const { leadId, surveyorsList, currentIndex } = job;

  try {
    // 1. Fetch current live status of this lead
    const lead = await db.collection("lead").findOne({ _id: leadId });
    
    // 2. Short-circuit: If the lead doesn't exist or has already been accepted, kill this ticket chain
    if (!lead || lead.status === "accepted") {
      console.log(`🎯 Lead ${leadId} was already accepted or completed. Ending cascade chain.`);
      await db.collection("jobs_queue").updateOne(
        { _id: job._id },
        { $set: { status: "completed", completedAt: new Date() } }
      );
      return;
    }

    // 3. Out-of-bounds check: If we've exhausted our entire list of local surveyors
    if (currentIndex >= surveyorsList.length) {                  
      console.log(`❌ All surveyors exhausted for Lead ${leadId}. None accepted.`);
      await db.collection("jobs_queue").updateOne(
        { _id: job._id },
        { $set: { status: "failed", reason: "All active surveyors timed out or rejected.", updatedAt: new Date() } }
      );
      return;
    }

    // 4. Extract target worker information from the sorted array
    const targetSurveyor = surveyorsList[currentIndex];
    console.log(`🔍 Attempting assignment to Surveyor #${currentIndex + 1}: ${targetSurveyor.phoneNo} (${targetSurveyor.distance.toFixed(2)} km away)`);

    // 5. Look up their FCM device token inside userDetails Safely
    const workerProfile = await db.collection("userDetails").findOne({ _id: targetSurveyor.phoneNo });
    
    let tokenSent = false;
    if (workerProfile && workerProfile.PlatformInfo && Array.isArray(workerProfile.PlatformInfo.devices)) {
      const devices = workerProfile.PlatformInfo.devices;
      const activeDevice = devices.find(d => d.isLastLoggedIn === true && d.fcmToken);
      const fallbackDevice = !activeDevice ? devices.find(d => d.fcmToken) : null;
      
      const targetDevice = activeDevice || fallbackDevice;
      const fcmToken = targetDevice ? targetDevice.fcmToken : null;

      if (fcmToken && fcmToken.trim().length > 0) {
        tokenSent = await sendLeadFCMNotification(
          fcmToken.trim(),
          lead.name,
          leadId,
          lead.kilovolt,
          lead.address
        );
      }
    }

    if (tokenSent) {
      console.log(`⚡ Dispatch notification pushed out successfully to ${targetSurveyor.phoneNo}`);
    } else {
      console.log(`⚠️ Could not transmit notification directly to phone (missing token/profile for ${targetSurveyor.phoneNo}).`);
    }

    
    const nextTickTime = new Date();
    nextTickTime.setSeconds(nextTickTime.getSeconds() + 30);

    await db.collection("jobs_queue").updateOne(
      { _id: job._id },
      {
        $set: {
          currentIndex: currentIndex + 1,
          runAt: nextTickTime,              
          status: "pending",               
          lockedAt: null
        }
      }
    );
    console.log(`⏰ Next countdown heartbeat set for: ${nextTickTime.toLocaleTimeString()}`);

  } catch (err) {
    console.error(`❌ Critical failure inside handleCascadingDispatchJob for task ${job._id}:`, err.message);
    await db.collection("jobs_queue").updateOne(
      { _id: job._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};

const processAllCustomersWeeklyJobs = async (db, masterJob) => {
  try {
    // 🔍 Pull users with registered devices
    const users = await db.collection("userDetails").find({ "PlatformInfo.devices.0": { $exists: true } }).toArray();
    console.log(`📋 Found ${users.length} users with registered devices in local userDetails collection.`);

    const today = new Date();
    const currentDay = today.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startTime = monday.toISOString().split('T')[0]; 
    const endTime = sunday.toISOString().split('T')[0];

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      // 📱 EXTRACT ALL TOKENS
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) {
        console.log(`ℹ️ User ${phoneNo} skipped: No active tokens inside device array.`);
        continue;
      }

      let totalUserWeeklyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      console.log(`👤 Processing user ${phoneNo} across ${stations.length} connected station(s)...`);

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          console.log(`   📊 Fetching solar data for Station ID: ${stationId}`);
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            });
          }

          totalUserWeeklyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch data for Station ${stationId}:`, stationError.message);
        }
      }

      // 🚀 TRANSMIT TO ALL REGISTERED TOKENS VIA SEND-EACH MULTICAST PACKET
      if (processedStationsCount > 0) {
        totalUserWeeklyUnits = Number(totalUserWeeklyUnits.toFixed(2));
        const statusTitle = "☀️ Your Weekly Solar Report is Ready!";
        const finalNotificationBody = `Your weekly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserWeeklyUnits} Units`;
        
        // Map every token into a dual-platform payload layout (Android + iOS Default Sounds)
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: {
            title: statusTitle,
            body: finalNotificationBody,
          },
          android: {
            priority: "high",
            notification: {
              channelId: "weekly_summary_channel_v1", // Clean channel for standard alerts
              sound: "default",                        // Android Native Default Sound
              clickAction: "WEEKLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: {
                sound: "default",                      // ✅ iOS Native Default Sound
                category: "WEEKLY_SUMMARY_NOTIFICATION_ACTION"
              }
            }
          },
          data: {
            type: "weekly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserWeeklyUnits),
            show_actions: "false"
          }
        }));

        console.log(`⚡ Dispatching batch messages to all (${tokensToBroadcast.length}) registered devices for user ${phoneNo}...`);
        
        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          console.log(`📋 Multicast results for ${phoneNo}: [${batchResponse.successCount} passed / ${batchResponse.failureCount} failed]`);
          
          // 🧼 SELF-CLEANING RECOVERY MECHANISM
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              console.warn(`⚠️ Target Token Delivery Failure Context:`, errorInstance.code);

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                console.log(`🧼 Stale/Uninstalled device detected. Surgically plucking token from MongoDB...`);
                
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { 
                    $pull: { 
                      "PlatformInfo.devices": { fcmToken: targetBadToken } 
                    } 
                  }
                );
                
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Complete breakdown executing multi-device send operation:`, multicastErr.message);
        }
      }
    }

    // ⏱️ TESTING TIMER: Maintained at 30 seconds for your frequency check
    const nextRunTime = new Date();
    nextRunTime.setSeconds(nextRunTime.getSeconds() + 30); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      {
        $set: {
          status: "pending",
          runAt: nextRunTime,
          lockedAt: null,
          lastRunAt: new Date()
        }
      }
    );

    console.log(`✅ Master Loop finished. NEXT TESTING TICK SCHEDULED FOR: ${nextRunTime.toLocaleTimeString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};

// 🗓️ ✅ NEW MONTHLY BACKEND TRACKING SYSTEM (TESTING SETUP)
const processAllCustomersMonthlyJobs = async (db, masterJob) => {
  try {
    const users = await db.collection("userDetails").find({ "PlatformInfo.devices.0": { $exists: true } }).toArray();
    console.log(`📋 Found ${users.length} users with registered devices in local userDetails collection.`);

    // 📅 DYNAMIC TESTING RANGE: 1st day of current month until today's date
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const startTime = startOfMonth.toISOString().split('T')[0]; 
    const endTime = today.toISOString().split('T')[0];

    console.log(`⏳ Monthly summary querying date range parameters: [From: ${startTime} To: ${endTime}]`);

    for (const user of users) {
      const phoneNo = user._id;
      const stations = user.devicelist || [];
      
      // 📱 EXTRACT TOKENS
      let tokensToBroadcast = [];
      if (user.PlatformInfo && Array.isArray(user.PlatformInfo.devices)) {
        tokensToBroadcast = user.PlatformInfo.devices
          .map(d => d.fcmToken)
          .filter(token => token && token.trim().length > 0);
      }

      if (tokensToBroadcast.length === 0) {
        console.log(`ℹ️ User ${phoneNo} skipped: No active tokens inside device array.`);
        continue;
      }

      let totalUserMonthlyUnits = 0;
      let processedStationsCount = 0;
      let stationBreakdownText = ""; 

      console.log(`👤 Processing user ${phoneNo} across ${stations.length} connected station(s)...`);

      for (const station of stations) {
        const stationId = station.id;
        const stationCustomName = station.name || `Station ${stationId}`;
        if (!stationId) continue;

        try {
          console.log(`   📊 Fetching monthly solar data for Station ID: ${stationId}`);
          const data = await getSolarmanDataCore(db, user, stationId, 2, startTime, endTime);

          let stationUnits = 0;
          if (data && data.stationDataItems && Array.isArray(data.stationDataItems)) {
            data.stationDataItems.forEach(item => {
              if (item.generationValue) {
                stationUnits += Number(item.generationValue);
              }
            });
          }

          totalUserMonthlyUnits += stationUnits;
          processedStationsCount++;
          stationBreakdownText += `• ${stationCustomName}: ${stationUnits.toFixed(2)} Units\n`;

        } catch (stationError) {
          console.error(`   ⚠️ Failed to fetch monthly data for Station ${stationId}:`, stationError.message);
        }
      }

      // 🚀 TRANSMIT MONTHLY LOGS TO ALL DEVICES VIA MULTICAST BATCH (WITH DUAL-PLATFORM DEFAULT SOUNDS)
      if (processedStationsCount > 0) {
        totalUserMonthlyUnits = Number(totalUserMonthlyUnits.toFixed(2));
        const statusTitle = "☀️ Your Monthly Solar Summary is Ready!";
        const finalNotificationBody = `Your monthly summary breakdown:\n${stationBreakdownText}Total Generation: ${totalUserMonthlyUnits} Units`;
        
        const messagesPayload = tokensToBroadcast.map(token => ({
          token: token.trim(),
          notification: {
            title: statusTitle,
            body: finalNotificationBody,
          },
          android: {
            priority: "high",
            notification: {
              channelId: "monthly_summary_channel_v1", // New independent platform channel
              sound: "default",                        // Android default notification beep
              clickAction: "MONTHLY_SUMMARY_NOTIFICATION_ACTION",
            }
          },
          apns: {
            payload: {
              aps: {
                sound: "default",                      // iOS standard text alert sound
                category: "MONTHLY_SUMMARY_NOTIFICATION_ACTION"
              }
            }
          },
          data: {
            type: "monthly_summary",
            title: statusTitle,
            body: finalNotificationBody,
            totalUnits: String(totalUserMonthlyUnits),
            show_actions: "false"
          }
        }));

        console.log(`⚡ Dispatching monthly batch messages to all (${tokensToBroadcast.length}) registered devices for user ${phoneNo}...`);
        
        try {
          const batchResponse = await admin.messaging().sendEach(messagesPayload);
          console.log(`📋 Monthly multicast results for ${phoneNo}: [${batchResponse.successCount} passed / ${batchResponse.failureCount} failed]`);
          
          // 🧼 RECOVERY MAINTENANCE CYCLE
          for (let index = 0; index < batchResponse.responses.length; index++) {
            const singleResponse = batchResponse.responses[index];
            
            if (!singleResponse.success) {
              const errorInstance = singleResponse.error;
              const targetBadToken = tokensToBroadcast[index];

              console.warn(`⚠️ Target Monthly Token Delivery Failure Context:`, errorInstance.code);

              if (errorInstance.code === 'messaging/registration-token-not-registered') {
                console.log(`🧼 Stale/Uninstalled device detected. Surgically plucking token from MongoDB...`);
                
                await db.collection("userDetails").updateOne(
                  { _id: phoneNo },
                  { 
                    $pull: { 
                      "PlatformInfo.devices": { fcmToken: targetBadToken } 
                    } 
                  }
                );
                
              }
            }
          }
        } catch (multicastErr) {
          console.error(`❌ Complete breakdown executing multi-device monthly operation:`, multicastErr.message);
        }
      }
    }

    // ⏱️ TESTING LOOP INTERVAL: Recovers back to pending every 30 seconds for easy log checking
    const nextRunTime = new Date();
    nextRunTime.setSeconds(nextRunTime.getSeconds() + 30); 

    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      {
        $set: {
          status: "pending",
          runAt: nextRunTime,
          lockedAt: null,
          lastRunAt: new Date()
        }
      }
    );

    console.log(`✅ Monthly Master Loop finished. NEXT TESTING TICK SCHEDULED FOR: ${nextRunTime.toLocaleTimeString()}`);

  } catch (error) {
    console.error("❌ Critical breakdown in Monthly Master Loop processing:", error.message);
    await db.collection("jobs_queue").updateOne(
      { _id: masterJob._id },
      { $set: { status: "pending", lockedAt: null } }
    );
  }
};
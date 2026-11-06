const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
module.exports={pool,q:(t,p)=>pool.query(t,p).then(r=>r.rows)};
